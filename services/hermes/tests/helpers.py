"""Spawn-safe test worker targets; these never access the network."""

import time


def fixture_worker(payload, cancel_event, sender):
    query = payload["query"]
    try:
        if query.startswith("hang"):
            # Deliberately ignore cooperative cancellation to exercise the
            # parent's terminate/kill/join path.
            while True:
                time.sleep(0.05)
        if query.startswith("slow"):
            time.sleep(0.15)
        if query.startswith("bad-error"):
            sender.send({"kind": "error", "code": "OPENAI_API_KEY=never-return-this"})
            return
        sender.send({
            "kind": "completed",
            "answer": "fixture-answer-" + ("x" * 17_000),
            "sources": [
                {"title": "Observed source", "url": "https://example.org/research"},
                {"title": "Credential URL", "url": "https://user:secret" + chr(64) + "example.org/private"},
                {"title": "Local URL", "url": "http://127.0.0.1/admin"},
                {"title": "Unsafe scheme", "url": "javascript:alert(1)"},
            ],
        })
    finally:
        sender.close()

