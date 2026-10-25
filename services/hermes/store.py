"""Durable, single-owner task storage for the LOOI Hermes service."""

from __future__ import annotations

import base64
import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled", "interrupted"})
ALL_STATUSES = frozenset({"queued", "running", "cancelling", *TERMINAL_STATUSES})
_CURSOR_RE = re.compile(r"[A-Za-z0-9_-]{1,256}\Z")
_CURSOR_TIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")


class QueueFull(Exception):
    pass


class TaskConflict(Exception):
    pass


class TaskDeleted(Exception):
    """The task id has a permanent receipt and must never be executed again."""


class TaskNotFound(Exception):
    pass


class TaskNotTerminal(Exception):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def encode_task_cursor(created_at: str, task_id: str) -> str:
    """Encode the stable descending keyset boundary for a task page."""
    raw = f"{created_at}\n{task_id}".encode("ascii")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_task_cursor(cursor: str) -> tuple[str, str] | None:
    """Validate an opaque timestamp/UUID cursor without exposing any server key."""
    if not isinstance(cursor, str) or not _CURSOR_RE.fullmatch(cursor):
        return None
    try:
        raw = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
        ).decode("ascii")
        created_at, task_id = raw.split("\n", 1)
        if not _CURSOR_TIME_RE.fullmatch(created_at):
            return None
        parsed_time = datetime.fromisoformat(created_at[:-1] + "+00:00")
        if parsed_time.tzinfo is None or parsed_time.isoformat(timespec="milliseconds").replace("+00:00", "Z") != created_at:
            return None
        # IDs are normalized UUIDs before they enter the store; requiring that exact
        # representation keeps cursor comparisons canonical and unambiguous.
        from uuid import UUID
        if str(UUID(task_id)) != task_id:
            return None
        return created_at, task_id
    except (ValueError, UnicodeDecodeError):
        return None


def _task_from_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        sources = json.loads(row["sources"])
        if not isinstance(sources, list):
            sources = []
    except (TypeError, json.JSONDecodeError):
        sources = []
    return {
        "id": row["id"],
        "query": row["query"],
        "language": row["language"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "answer": row["answer"],
        "sources": sources,
        "error": row["error"],
    }


class TaskStore:
    """SQLite task ledger. Queries and answers are stored only in this DB."""

    def __init__(self, path: str | os.PathLike[str], *, max_queued: int = 8, max_records: int = 10_000):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.max_queued = max_queued
        self.max_records = max_records
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=FULL")
        return conn

    def _initialize(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS tasks (
                        id TEXT PRIMARY KEY,
                        query TEXT NOT NULL,
                        language TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        answer TEXT,
                        sources TEXT NOT NULL DEFAULT '[]',
                        error TEXT
                    )"""
                )
                # Keep only the random id after explicit deletion. The receipt
                # prevents a lost-response retry from re-running the same job.
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS deleted_task_ids (
                        id TEXT PRIMARY KEY,
                        deleted_at TEXT NOT NULL
                    )"""
                )
                conn.execute("CREATE INDEX IF NOT EXISTS tasks_status_created ON tasks(status, created_at, id)")
                conn.execute("CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created_at DESC, id DESC)")
            finally:
                conn.close()
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass

    def recover_after_restart(self) -> int:
        """Do not replay work whose provider/tool outcome may be unknown."""
        now = utc_now()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                cursor = conn.execute(
                    "UPDATE tasks SET status='interrupted', updated_at=?, answer=NULL, sources='[]', error='E_RESTARTED' "
                    "WHERE status IN ('running', 'cancelling')",
                    (now,),
                )
                conn.commit()
                return cursor.rowcount
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def create(self, task_id: str, query: str, language: str) -> tuple[dict[str, Any], bool]:
        now = utc_now()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                existing = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                if existing is not None:
                    if existing["query"] != query or existing["language"] != language:
                        raise TaskConflict
                    conn.commit()
                    return _task_from_row(existing), False
                deleted = conn.execute("SELECT 1 FROM deleted_task_ids WHERE id=?", (task_id,)).fetchone()
                if deleted is not None:
                    raise TaskDeleted

                queued = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='queued'").fetchone()[0]
                total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
                if queued >= self.max_queued or total >= self.max_records:
                    raise QueueFull
                conn.execute(
                    "INSERT INTO tasks(id, query, language, status, created_at, updated_at) VALUES(?,?,?,'queued',?,?)",
                    (task_id, query, language, now, now),
                )
                row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                conn.commit()
                return _task_from_row(row), True
            except Exception:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                conn.close()

    def claim_next_queued(self) -> dict[str, Any] | None:
        now = utc_now()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT * FROM tasks WHERE status='queued' ORDER BY created_at ASC, id ASC LIMIT 1"
                ).fetchone()
                if row is None:
                    conn.commit()
                    return None
                changed = conn.execute(
                    "UPDATE tasks SET status='running', updated_at=? WHERE id=? AND status='queued'",
                    (now, row["id"]),
                ).rowcount
                if changed != 1:
                    conn.rollback()
                    return None
                updated = conn.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone()
                conn.commit()
                return _task_from_row(updated)
            except Exception:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                conn.close()

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                return _task_from_row(row) if row else None
            finally:
                conn.close()

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?", (min(max(limit, 1), 50),)
                ).fetchall()
                return [_task_from_row(row) for row in rows]
            finally:
                conn.close()

    def list_page(
        self, cursor: tuple[str, str] | None = None, limit: int = 50
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Return a bounded descending keyset page and its next opaque cursor."""
        page_size = min(max(limit, 1), 50)
        with self._lock:
            conn = self._connect()
            try:
                if cursor is None:
                    rows = conn.execute(
                        "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?",
                        (page_size + 1,),
                    ).fetchall()
                else:
                    created_at, task_id = cursor
                    rows = conn.execute(
                        """SELECT * FROM tasks
                           WHERE created_at < ? OR (created_at = ? AND id < ?)
                           ORDER BY created_at DESC, id DESC LIMIT ?""",
                        (created_at, created_at, task_id, page_size + 1),
                    ).fetchall()
                has_more = len(rows) > page_size
                page_rows = rows[:page_size]
                tasks = [_task_from_row(row) for row in page_rows]
                next_cursor = None
                if has_more and page_rows:
                    last = page_rows[-1]
                    next_cursor = encode_task_cursor(last["created_at"], last["id"])
                return tasks, next_cursor
            finally:
                conn.close()

    def cancel(self, task_id: str) -> dict[str, Any] | None:
        now = utc_now()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                if row is None:
                    conn.commit()
                    return None
                if row["status"] == "queued":
                    conn.execute(
                        "UPDATE tasks SET status='cancelled', updated_at=?, error=NULL WHERE id=? AND status='queued'",
                        (now, task_id),
                    )
                elif row["status"] == "running":
                    conn.execute(
                        "UPDATE tasks SET status='cancelling', updated_at=? WHERE id=? AND status='running'",
                        (now, task_id),
                    )
                updated = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                conn.commit()
                return _task_from_row(updated)
            except Exception:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                conn.close()

    def finish(self, task_id: str, status: str, *, answer: str | None = None,
               sources: list[dict[str, str]] | None = None, error: str | None = None) -> None:
        if status not in TERMINAL_STATUSES:
            raise ValueError("finish() requires a terminal status")
        now = utc_now()
        encoded_sources = json.dumps(sources or [], ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
                if row is None:
                    conn.commit()
                    return
                if row["status"] in TERMINAL_STATUSES:
                    conn.commit()
                    return
                conn.execute(
                    "UPDATE tasks SET status=?, updated_at=?, answer=?, sources=?, error=? WHERE id=?",
                    (status, now, answer, encoded_sources, error, task_id),
                )
                conn.commit()
            except Exception:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                conn.close()

    def delete_terminal(self, task_id: str) -> bool:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
                if row is None:
                    receipt = conn.execute("SELECT 1 FROM deleted_task_ids WHERE id=?", (task_id,)).fetchone()
                    conn.commit()
                    return receipt is not None
                if row["status"] not in TERMINAL_STATUSES:
                    raise TaskNotTerminal
                conn.execute(
                    "INSERT OR IGNORE INTO deleted_task_ids(id, deleted_at) VALUES(?, ?)",
                    (task_id, utc_now()),
                )
                conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
                conn.commit()
                return True
            except Exception:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                conn.close()

