"""Task lifecycle manager with one bounded, killable Hermes worker process."""

from __future__ import annotations

import multiprocessing
import threading
import time
from typing import Any, Callable

from .store import QueueFull, TaskStore
from .worker import DEFAULT_MODEL, _safe_url, run_hermes_task


MAX_QUEUED = 8
MAX_RECORDS = 10_000
MAX_ANSWER_CHARS = 16_000
MAX_SOURCE_COUNT = 10
_ALLOWED_FAILURES = {"E_CONFIGURATION", "E_RUNTIME_POLICY", "E_MODEL_FAILED", "E_TIMEOUT", "E_WORKER_FAILED"}


class TaskManager:
    def __init__(
        self,
        store: TaskStore,
        *,
        worker_target: Callable[..., None] = run_hermes_task,
        model: str = DEFAULT_MODEL,
        hermes_home: str = "/opt/data/looi-hermes/home",
        timeout_seconds: float = 100.0,
        cancel_grace_seconds: float = 2.0,
        poll_seconds: float = 0.05,
        start_worker: bool = True,
    ):
        self.store = store
        self.worker_target = worker_target
        self.model = model
        self.hermes_home = hermes_home
        self.timeout_seconds = timeout_seconds
        self.cancel_grace_seconds = cancel_grace_seconds
        self.poll_seconds = poll_seconds
        self._context = multiprocessing.get_context("spawn")
        self._condition = threading.Condition(threading.RLock())
        self._stop = False
        self._active_task_id: str | None = None
        self._active_process: multiprocessing.Process | None = None
        self._active_cancel_event: Any = None
        self._cancel_requested: dict[str, str] = {}
        self._last_fault: str | None = None
        self.recovered_count = self.store.recover_after_restart()
        self._thread: threading.Thread | None = None
        if start_worker:
            self.start()

    def start(self) -> None:
        with self._condition:
            if self._thread is not None:
                return
            self._thread = threading.Thread(target=self._run_loop, name="looi-hermes-worker", daemon=True)
            self._thread.start()

    @property
    def last_fault(self) -> str | None:
        with self._condition:
            return self._last_fault

    @property
    def is_ready(self) -> bool:
        with self._condition:
            return (
                not self._stop
                and self._last_fault is None
                and self._thread is not None
                and self._thread.is_alive()
            )

    def enqueue(self, task_id: str, query: str, language: str) -> tuple[dict[str, Any], bool]:
        with self._condition:
            task, created = self.store.create(task_id, query, language)
            self._condition.notify_all()
            return task, created

    def get(self, task_id: str) -> dict[str, Any] | None:
        return self.store.get(task_id)

    def list(self) -> list[dict[str, Any]]:
        return self.store.list(50)

    def list_page(self, cursor: tuple[str, str] | None = None) -> tuple[list[dict[str, Any]], str | None]:
        return self.store.list_page(cursor, 50)

    def cancel(self, task_id: str) -> dict[str, Any] | None:
        with self._condition:
            task = self.store.cancel(task_id)
            if task is None:
                return None
            if task["status"] == "cancelling":
                self._cancel_requested[task_id] = "cancelled"
                if self._active_task_id == task_id and self._active_cancel_event is not None:
                    self._active_cancel_event.set()
            self._condition.notify_all()
            return task

    def delete(self, task_id: str) -> bool:
        with self._condition:
            return self.store.delete_terminal(task_id)

    def close(self, join_timeout: float | None = None) -> None:
        with self._condition:
            self._stop = True
            if self._active_cancel_event is not None:
                self._active_cancel_event.set()
            self._condition.notify_all()
            thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            timeout = join_timeout if join_timeout is not None else self.cancel_grace_seconds + 5.0
            thread.join(timeout=max(0.1, timeout))

    def _run_loop(self) -> None:
        try:
            self._run_loop_until_stopped()
        except Exception:
            # If the durable queue can no longer be serviced, readiness must
            # fail closed. Keep the public fault stable and free of DB paths.
            with self._condition:
                self._last_fault = "E_WORKER_LOOP_FAILED"
                self._stop = True
                self._condition.notify_all()

    def _run_loop_until_stopped(self) -> None:
        while True:
            with self._condition:
                if self._stop:
                    return
                task = self.store.claim_next_queued()
                if task is None:
                    self._condition.wait(timeout=0.25)
                    continue
                task_id = task["id"]
                cancel_event = self._context.Event()
                self._active_task_id = task_id
                self._active_cancel_event = cancel_event

            self._run_one(task, cancel_event)

            with self._condition:
                self._active_task_id = None
                self._active_process = None
                self._active_cancel_event = None
                self._cancel_requested.pop(task_id, None)
                self._condition.notify_all()

    def _run_one(self, task: dict[str, Any], cancel_event: Any) -> None:
        task_id = task["id"]
        receive, send = self._context.Pipe(duplex=False)
        payload = {
            "id": task_id,
            "query": task["query"],
            "language": task["language"],
            "model": self.model,
            "hermes_home": self.hermes_home,
        }
        process = self._context.Process(
            target=self.worker_target,
            args=(payload, cancel_event, send),
            name=f"looi-hermes-{task_id[:8]}",
            daemon=True,
        )
        with self._condition:
            self._active_process = process

        message: dict[str, Any] | None = None
        exit_code: int | None = None
        reason: str | None = None
        grace_deadline: float | None = None
        started_at = time.monotonic()
        try:
            process.start()
            send.close()
            while process.is_alive():
                now = time.monotonic()
                if receive.poll():
                    try:
                        candidate = receive.recv()
                        if isinstance(candidate, dict):
                            message = candidate
                    except (EOFError, OSError):
                        pass

                if reason is None:
                    with self._condition:
                        if self._stop:
                            reason = "shutdown"
                        elif self._cancel_requested.get(task_id) == "cancelled":
                            reason = "cancelled"
                    if reason is None and now - started_at >= self.timeout_seconds:
                        reason = "timeout"
                    if reason is not None:
                        cancel_event.set()
                        grace_deadline = now + self.cancel_grace_seconds

                if reason is not None and grace_deadline is not None and now >= grace_deadline and process.is_alive():
                    process.terminate()
                    process.join(timeout=0.5)
                    if process.is_alive() and hasattr(process, "kill"):
                        process.kill()
                    # Keep the sole worker slot occupied until the child is
                    # actually gone, even if a native extension ignores cancel.
                    while process.is_alive():
                        process.join(timeout=0.25)
                    break
                time.sleep(self.poll_seconds)

            process.join()
            exit_code = process.exitcode
            if receive.poll():
                try:
                    candidate = receive.recv()
                    if isinstance(candidate, dict):
                        message = candidate
                except (EOFError, OSError):
                    pass
        except Exception:
            # Process creation errors are intentionally mapped to a stable,
            # non-sensitive public code.
            reason = reason or "worker_error"
        finally:
            try:
                send.close()
            except Exception:
                pass
            try:
                receive.close()
            except Exception:
                pass
            if process.pid is not None:
                try:
                    process.close()
                except (ValueError, OSError):
                    pass

        current = self.store.get(task_id)
        if current is None:
            return
        was_cancelled = current["status"] == "cancelling"
        if reason == "shutdown":
            self.store.finish(task_id, "interrupted", error="E_SHUTDOWN")
        elif reason == "timeout":
            self.store.finish(task_id, "failed", error="E_TIMEOUT")
        elif reason == "cancelled" or was_cancelled:
            self.store.finish(task_id, "cancelled")
        elif reason == "worker_error" or exit_code not in (0, None):
            self.store.finish(task_id, "failed", error="E_WORKER_FAILED")
        elif not isinstance(message, dict):
            self.store.finish(task_id, "failed", error="E_WORKER_FAILED")
        elif message.get("kind") == "completed":
            answer = message.get("answer")
            sources = message.get("sources")
            if not isinstance(answer, str) or not answer.strip():
                self.store.finish(task_id, "failed", error="E_MODEL_FAILED")
            else:
                safe_sources = _safe_sources(sources)
                self.store.finish(
                    task_id,
                    "completed",
                    answer=answer.strip()[:MAX_ANSWER_CHARS],
                    sources=safe_sources,
                )
        elif message.get("kind") == "cancelled":
            self.store.finish(task_id, "cancelled")
        elif message.get("kind") == "error":
            code = message.get("code")
            self.store.finish(task_id, "failed", error=code if code in _ALLOWED_FAILURES else "E_MODEL_FAILED")
        else:
            self.store.finish(task_id, "failed", error="E_WORKER_FAILED")


def _safe_sources(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in value:
        if len(result) >= MAX_SOURCE_COUNT or not isinstance(item, dict):
            break
        title, url = item.get("title"), item.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        title = "".join(ch for ch in title.strip() if ch >= " " and ch != "\x7f")[:250]
        url = url.strip()
        safe_url = _safe_url(url)
        if not title or safe_url is None or safe_url in seen:
            continue
        seen.add(safe_url)
        result.append({"title": title, "url": safe_url})
    return result

