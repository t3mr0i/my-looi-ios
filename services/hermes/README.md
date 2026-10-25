# LOOI Hermes research service

This service uses Hermes Agent `v0.22.5` as a Python library and exposes the authenticated, task-based LOOI API. Its agent tool allowlist is the pinned Hermes `search` toolset, which is checked at startup to resolve to `web_search` alone. Search is explicitly pinned to DDGS with keyless fallback and rescue disabled. The agent cannot access robot controls, files, terminal commands, Hermes memory, or URL extraction.

## Runtime settings

Set `LOOI_AGENT_TOKEN` to a 32–512 character base64url bearer token, for example `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`, and provide the existing `OPENAI_API_KEY` as a Fly secret. The default inference model is `gpt-6-luna`; operators can override it with `LOOI_HERMES_MODEL`. Startup verifies the pinned DDGS package, registered Hermes provider, and tool allowlist without making a model or search request. The Docker build creates a separate Hermes-core + DDGS environment from the pinned upstream lockfile, so runtime lazy installation is not needed. `LOOI_AGENT_TIMEOUT_SECONDS` and `LOOI_AGENT_CANCEL_GRACE_SECONDS` are bounded operator settings.

The API accepts `en`, `ru`, and `uk` task languages. Requests are limited to 2,000 query characters. One worker processes a task at a time, with up to eight queued tasks and 10,000 retained task rows. `GET /v1/tasks` returns at most 50 summaries with `answer: null` and `sources: []`, plus an opaque `nextCursor` when another page exists; request that page with `?cursor=<nextCursor>`. The cursor uses stable `(created_at, id)` keyset ordering, so the whole retained history stays reachable without returning large task results. Fetch `GET /v1/tasks/{id}` for the full result. Output is capped at 16,000 characters and ten sources. The HTTP facade caps request and response bodies at 2 MiB. `/health` returns `503` when the queue worker has stopped or faulted.

## Persistence and deletion

The SQLite database at `/opt/data/looi-hermes/tasks.sqlite3` is on the mounted Fly volume. It stores the task query, language, status, final answer, source list, and a small public error code. Hermes memory and trajectories are disabled. A worker interrupted by restart is marked `interrupted` and is never replayed, because a completed provider request may have an unknown outcome. Queued tasks that had not started remain queued.

`DELETE /v1/tasks/{id}` permanently removes the task row only after it reaches a terminal state. A minimal receipt containing only the UUID and deletion time remains indefinitely in SQLite, so a retry after a lost DELETE/PUT response cannot re-run that deleted task; a later PUT with that UUID returns `410 E_TASK_DELETED`, and repeating DELETE returns `204`. Removing the mounted SQLite volume removes task rows and receipts. The bearer token is compared in constant time and is never stored in SQLite.

## Local checks

From the repository root:

```sh
python3 -m unittest discover -s services/hermes/tests -v
```

The behavior tests use local fixture workers and do not call a model, DDGS, or any paid service. The container build uses the official Hermes image as its base; the first real runtime check should start the image with secrets configured and exercise `/health`, the capabilities endpoint, and a fixture-backed task before deployment.
