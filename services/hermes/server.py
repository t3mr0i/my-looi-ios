"""Authenticated HTTP API for LOOI's single-owner Hermes research worker."""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import UUID

from .service import MAX_QUEUED, MAX_RECORDS, TaskManager
from .store import QueueFull, TaskConflict, TaskDeleted, TaskNotTerminal, TaskStore, decode_task_cursor
from .worker import DEFAULT_MODEL, prepare_hermes_home, validate_runtime


MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_QUERY_CHARS = 2_000
MAX_TASKS_PER_PAGE = 50
CAPABILITIES = {
    "protocol": 1,
    "service": "looi-hermes",
    "capabilities": ["tasks", "cancel", "delete"],
}
LANGUAGES = frozenset({"en", "ru", "uk"})
logger = logging.getLogger("looi-hermes")
_AGENT_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{32,512}\Z")


def valid_agent_token(value: str) -> bool:
    """Match the mobile client's base64url bearer-token contract."""
    return isinstance(value, str) and _AGENT_TOKEN_RE.fullmatch(value) is not None


def _valid_uuid(value: str) -> str | None:
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
    canonical = str(parsed)
    return canonical if value.lower() == canonical else None


def dispatch_request(
    method: str,
    target: str,
    authorization: str,
    body: Any,
    manager: TaskManager,
    token: str,
    *,
    body_present: bool = False,
) -> tuple[int, dict[str, Any]]:
    """Pure endpoint dispatcher, also used by behavior tests without sockets."""
    parts = [unquote(part) for part in urlsplit(target).path.split("/") if part]
    if method == "GET" and parts == ["health"]:
        if manager.is_ready:
            return 200, {"status": "ok"}
        return 503, {"status": "unavailable"}
    supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied.encode("utf-8"), token.encode("utf-8")):
        return 401, {"error": "E_UNAUTHORIZED"}
    if method == "GET" and parts == ["v1", "capabilities"]:
        return 200, CAPABILITIES
    if method == "GET" and parts == ["v1", "tasks"]:
        try:
            query = parse_qs(urlsplit(target).query, keep_blank_values=True, strict_parsing=True, max_num_fields=1)
        except ValueError:
            return 400, {"error": "E_INVALID_CURSOR"}
        if set(query) - {"cursor"}:
            return 400, {"error": "E_INVALID_CURSOR"}
        cursor = None
        if "cursor" in query:
            values = query["cursor"]
            cursor = decode_task_cursor(values[0]) if len(values) == 1 else None
            if cursor is None:
                return 400, {"error": "E_INVALID_CURSOR"}
        tasks, next_cursor = manager.list_page(cursor)
        summaries = []
        for task in tasks[:MAX_TASKS_PER_PAGE]:
            summaries.append({**task, "answer": None, "sources": []})
        return 200, {"tasks": summaries, "nextCursor": next_cursor}
    if method == "GET" and len(parts) == 3 and parts[:2] == ["v1", "tasks"]:
        task_id = _valid_uuid(parts[2])
        task = manager.get(task_id) if task_id else None
        return (200, task) if task is not None else (404, {"error": "E_TASK_NOT_FOUND"})
    if method == "PUT":
        task_id = _valid_uuid(parts[2]) if len(parts) == 3 and parts[:2] == ["v1", "tasks"] else None
        if task_id is None:
            return 404, {"error": "E_NOT_FOUND"}
        if not isinstance(body, dict) or set(body) != {"query", "language"}:
            return 400, {"error": "E_INVALID_BODY"}
        query, language = body.get("query"), body.get("language")
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
            return 400, {"error": "E_INVALID_QUERY"}
        if not isinstance(language, str) or language not in LANGUAGES:
            return 400, {"error": "E_INVALID_LANGUAGE"}
        try:
            task, created = manager.enqueue(task_id, query, language)
        except TaskDeleted:
            return 410, {"error": "E_TASK_DELETED"}
        except TaskConflict:
            return 409, {"error": "E_IDEMPOTENCY_CONFLICT"}
        except QueueFull:
            return 503, {"error": "E_QUEUE_FULL"}
        return (202 if created else 200), task
    if method == "POST" and len(parts) == 4 and parts[:2] == ["v1", "tasks"] and parts[3] == "cancel":
        task_id = _valid_uuid(parts[2])
        if task_id is None:
            return 404, {"error": "E_NOT_FOUND"}
        if body_present or body is not None:
            return 400, {"error": "E_INVALID_BODY"}
        task = manager.cancel(task_id)
        return (200, task) if task is not None else (404, {"error": "E_TASK_NOT_FOUND"})
    if method == "DELETE" and len(parts) == 3 and parts[:2] == ["v1", "tasks"]:
        task_id = _valid_uuid(parts[2])
        if task_id is None:
            return 404, {"error": "E_NOT_FOUND"}
        try:
            deleted = manager.delete(task_id)
        except TaskNotTerminal:
            return 409, {"error": "E_TASK_NOT_TERMINAL"}
        if not deleted:
            return 404, {"error": "E_TASK_NOT_FOUND"}
        return 204, {}
    if method in {"GET", "PUT", "POST", "DELETE"}:
        return 404, {"error": "E_NOT_FOUND"}
    return 405, {"error": "E_METHOD_NOT_ALLOWED"}


class _BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, server_address: tuple[str, int], handler: type[BaseHTTPRequestHandler], *, max_threads: int = 32):
        self._request_slots = threading.BoundedSemaphore(max_threads)
        super().__init__(server_address, handler)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self._request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


def make_handler(manager: TaskManager, token: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(10.0)

        def log_message(self, format: str, *args: Any) -> None:
            # Request bodies and Authorization headers are never logged.
            logger.info("http request from %s: %s", self.client_address[0], format % args)

        def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
            status = code if 400 <= code <= 599 else 500
            self._json(status, {"error": f"E_HTTP_{status}"})

        def _json(self, status: int, value: dict[str, Any]) -> None:
            raw = b"" if status == 204 else json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(raw) > MAX_RESPONSE_BYTES:
                status = 500
                raw = b'{"error":"E_RESPONSE_TOO_LARGE"}'
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)
            self.close_connection = True

        def _authorized(self) -> bool:
            header = self.headers.get("Authorization", "")
            supplied = header[7:] if header.startswith("Bearer ") else ""
            return bool(supplied) and hmac.compare_digest(supplied.encode("utf-8"), token.encode("utf-8"))

        def _body(self) -> dict[str, Any] | None:
            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length) if raw_length is not None else -1
            except ValueError:
                length = -1
            if length < 0:
                self._json(400, {"error": "E_INVALID_BODY"})
                return None
            if length > MAX_BODY_BYTES:
                self._json(413, {"error": "E_BODY_TOO_LARGE"})
                return None
            try:
                body = json.loads(self.rfile.read(length))
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                self._json(400, {"error": "E_INVALID_BODY"})
                return None
            if not isinstance(body, dict):
                self._json(400, {"error": "E_INVALID_BODY"})
                return None
            return body

        def _path(self) -> list[str]:
            return [unquote(part) for part in urlsplit(self.path).path.split("/") if part]

        def do_GET(self) -> None:
            self._dispatch("GET")

        def do_PUT(self) -> None:
            if not self._authorized():
                self._json(401, {"error": "E_UNAUTHORIZED"})
                return
            body = self._body()
            if body is None:
                return
            self._dispatch("PUT", body=body, body_present=True)

        def do_POST(self) -> None:
            if not self._authorized():
                self._json(401, {"error": "E_UNAUTHORIZED"})
                return
            raw_length = self.headers.get("Content-Length", "0")
            try:
                body_present = int(raw_length) > 0
            except ValueError:
                self._json(400, {"error": "E_INVALID_BODY"})
                return
            self._dispatch("POST", body_present=body_present)

        def do_DELETE(self) -> None:
            if not self._authorized():
                self._json(401, {"error": "E_UNAUTHORIZED"})
                return
            self._dispatch("DELETE")

        def do_OPTIONS(self) -> None:
            self._json(405, {"error": "E_METHOD_NOT_ALLOWED"})

        def _dispatch(self, method: str, *, body: Any = None, body_present: bool = False) -> None:
            status, payload = dispatch_request(
                method,
                self.path,
                self.headers.get("Authorization", ""),
                body,
                manager,
                token,
                body_present=body_present,
            )
            self._json(status, payload)

    return Handler


def create_http_server(host: str, port: int, manager: TaskManager, token: str) -> _BoundedHTTPServer:
    return _BoundedHTTPServer((host, port), make_handler(manager, token))


def _positive_float(value: str | None, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value) if value is not None else default
    except ValueError:
        return default
    if parsed != parsed or parsed in {float("inf"), float("-inf")}:
        return default
    return min(max(parsed, minimum), maximum)


def main() -> None:
    token = os.environ.get("LOOI_AGENT_TOKEN", "")
    if not valid_agent_token(token):
        raise SystemExit("LOOI_AGENT_TOKEN must be 32-512 base64url characters")
    model = os.environ.get("LOOI_HERMES_MODEL", DEFAULT_MODEL)
    hermes_home = os.environ.get("LOOI_HERMES_HOME", "/opt/data/looi-hermes/home")
    db_path = os.environ.get("LOOI_AGENT_DB_PATH", "/opt/data/looi-hermes/tasks.sqlite3")
    prepare_hermes_home(hermes_home)
    try:
        validate_runtime(hermes_home, model=model)
    except Exception as exc:
        # Keep provider details and configuration secrets out of startup logs.
        logger.error("Hermes runtime startup check failed (%s)", type(exc).__name__)
        raise SystemExit("Hermes runtime startup check failed") from None

    store = TaskStore(db_path, max_queued=MAX_QUEUED, max_records=MAX_RECORDS)
    manager = TaskManager(
        store,
        model=model,
        hermes_home=hermes_home,
        timeout_seconds=_positive_float(os.environ.get("LOOI_AGENT_TIMEOUT_SECONDS"), 100.0, 5.0, 600.0),
        cancel_grace_seconds=_positive_float(os.environ.get("LOOI_AGENT_CANCEL_GRACE_SECONDS"), 2.0, 0.2, 10.0),
    )
    host = os.environ.get("LOOI_AGENT_HOST", "0.0.0.0")
    try:
        port = int(os.environ.get("PORT", "8080"))
    except ValueError:
        port = 8080
    httpd = create_http_server(host, port, manager, token)
    stop = threading.Event()

    def request_stop(signum: int, frame: Any) -> None:
        stop.set()

    previous_handlers = {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        previous_handlers[sig] = signal.signal(sig, request_stop)
    serving = threading.Thread(target=httpd.serve_forever, name="looi-hermes-http", daemon=True)
    serving.start()
    logger.info("LOOI Hermes HTTP service listening on %s:%s", host, port)
    try:
        stop.wait()
    finally:
        httpd.shutdown()
        httpd.server_close()
        manager.close()
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    main()

