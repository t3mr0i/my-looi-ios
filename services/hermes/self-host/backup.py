#!/usr/bin/env python3
"""Create a private, atomic SQLite backup using only the Python standard library."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
from pathlib import Path


class BackupFailure(Exception):
    pass


def create_backup(database: Path, output: Path) -> None:
    source_path = database.expanduser().resolve(strict=True)
    output_path = output.expanduser()

    if not source_path.is_file():
        raise BackupFailure("source database is not a regular file")
    if output_path.exists() or output_path.is_symlink():
        raise FileExistsError
    if not output_path.parent.is_dir():
        raise BackupFailure("output directory does not exist")

    temporary_path: Path | None = None
    try:
        file_descriptor, temporary_name = tempfile.mkstemp(
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        os.close(file_descriptor)
        os.chmod(temporary_path, 0o600)

        source_uri = f"{source_path.as_uri()}?mode=ro"
        source_connection = sqlite3.connect(source_uri, uri=True, timeout=30.0)
        target_connection = sqlite3.connect(temporary_path, timeout=30.0)
        try:
            source_connection.backup(target_connection, pages=256, sleep=0.1)

            # The source may use WAL. Normalize the output so the backup is
            # self-contained and remains restorable after copying only one file.
            journal_mode = target_connection.execute(
                "PRAGMA journal_mode=DELETE"
            ).fetchone()
            if journal_mode is None or journal_mode[0].lower() != "delete":
                raise BackupFailure("could not normalize backup journal mode")

            integrity = target_connection.execute("PRAGMA integrity_check").fetchall()
            if integrity != [("ok",)]:
                raise BackupFailure("SQLite integrity check failed")
            target_connection.commit()
        finally:
            target_connection.close()
            source_connection.close()

        if Path(f"{temporary_path}-wal").exists() or Path(f"{temporary_path}-shm").exists():
            raise BackupFailure("backup requires SQLite sidecar files")

        os.chmod(temporary_path, 0o600)
        with temporary_path.open("rb") as backup_file:
            header = backup_file.read(100)
            os.fsync(backup_file.fileno())
        if (
            len(header) < 100
            or header[:16] != b"SQLite format 3\x00"
            or header[18:20] != b"\x01\x01"
        ):
            raise BackupFailure("backup is not a standalone SQLite file")

        # The temp file shares the destination directory. Linking publishes a
        # complete backup atomically and fails if another process made the name.
        os.link(temporary_path, output_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
            Path(f"{temporary_path}-wal").unlink(missing_ok=True)
            Path(f"{temporary_path}-shm").unlink(missing_ok=True)
            Path(f"{temporary_path}-journal").unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path, help="SQLite database file")
    parser.add_argument("--output", required=True, type=Path, help="new backup file path")
    args = parser.parse_args()

    try:
        create_backup(args.database, args.output)
    except FileExistsError:
        print("Backup refused: output already exists.", file=sys.stderr)
        return 2
    except BackupFailure as error:
        print(f"Backup failed: {error}.", file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error):
        print("Backup failed: filesystem or SQLite operation failed.", file=sys.stderr)
        return 1

    print("Backup created successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
