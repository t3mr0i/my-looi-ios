# Runtime architecture

## Voice

The primary conversation path is Realtime PCM:

```text
Android AudioRecord (16 kHz mono PCM16)
  -> app-owned capture + platform AEC
  -> 16 -> 24 kHz resampling
  -> OpenAI Realtime WebSocket
  -> 24 kHz PCM16 output
  -> app-owned Android AudioTrack
```

Server VAD is authoritative for conversational turn detection. The app owns physical playback, so interruption stops local playback immediately and truncates the assistant item to the amount actually heard.

Completed Realtime input transcriptions are also checked by a narrow deterministic parser for explicitly addressed physical commands (for example, `LOOI, move back` or `LOOI, nod`). Those commands are executed locally through the existing robot safety controller; the Realtime model is not given autonomous movement tools. Forward/backward motion is time-bounded while Realtime retains sole microphone ownership.

Realtime WebRTC is retained only as an Advanced fallback/A-B path.

## Memory

Conversation history and durable facts are stored locally in SQLite. Realtime sessions receive a bounded local-memory context and can also use the local memory search tool for targeted retrieval.

Schema v2 adds optional fact origin and source-session provenance through an
idempotent additive migration. Backup format v1 accepts schema v1 or v2; exports
contain schema v2. Corrections retain the fact ID and original capture time,
replace text and normalization, mark a user edit and clear stale derived fields.
SQLite triggers update FTS in the same statement; deletion removes both copies.
No revision archive retains the old fact text.

UI corrections, deletion and restore serialize through a mutation gate. The
gate closes the active Realtime session before committing, prevents new sessions
until completion and rejects stale session-bound fact writes. Conversation
history and external backup files have independent lifecycles.

```mermaid
sequenceDiagram
  actor User
  participant UI as Memory screen
  participant Gate as Mutation gate
  participant Voice as Realtime router
  participant DB as SQLite and FTS
  User->>UI: Save corrected fact or confirm deletion
  UI->>Gate: Queue mutation and block new sessions
  Gate->>Voice: Close current session
  Voice-->>Gate: Session stopped
  Gate->>Gate: Clear active transcript
  Gate->>DB: Update or delete selected fact
  DB-->>Gate: Commit with FTS triggers
  Gate-->>UI: Result; allow new sessions
  User->>Voice: Start a new conversation
  Voice->>DB: Load current facts
```

## On-demand web research

Conversations links to a dedicated text research screen. An explicit submit
calls Responses with `gpt-6-luna`, `web_search`, a bounded query/output and
`store: false`, authenticated with the existing personal BYOK key. Only the
entered question is supplied as user context. The result parser checks response
status and citation bounds, permits HTTP(S) source URLs and renders clickable
inline citation markers and source links. A timeout/abort and request generation
gate prevent stale results from reaching a superseding or unmounted screen.
This path grants no memory, device or physical-action tools and does not alter
the accepted Realtime audio transport. A future operator-key product requires
a server-side key boundary instead of embedding an operator key in the app.

## Optional Hermes research tasks

The Agent tasks route uses a versioned single-owner HTTPS facade over a pinned
Hermes Python runtime. Client-assigned UUIDs are journaled before PUT; retries
reuse the exact identity and payload. The journal is encrypted with MMKV AES-256
and a device-only Keychain key. Connection secrets live separately in SecureStore.
The production transport uses `expo/fetch` streams, refuses redirects and aborts
responses above a byte limit. Focus/foreground polling loads cursor-paged task
summaries; full results load separately with stale-response guards.

The server owns a SQLite queue on a persistent Fly volume. Each job uses an
isolated process with a bounded deadline and a search-only tool allowlist.
Cancelling retains the worker slot until process exit. Restart marks in-flight
work interrupted and does not replay it. Terminal deletion preserves a UUID-only
receipt so a lost response cannot recreate that job. One Fly Machine is required
for this storage design. [Deployment and lifecycle](hermes-agent.md).

This optional route takes only explicit typed task input; it grants no memory,
audio, camera or motor access and creates no scheduled jobs or notifications.
Normal Realtime/BLE operation does not require the service.

## Wake and safety

The wake/command pipeline remains local. Shared microphone handoff is deliberately serialized before Realtime capture begins. Screen-off/background transitions stop sensitive runtime activity.

Robot movement always retains STOP, deadman, BLE lifecycle, and directional cliff-safety guardrails.

## Robot transport

The physical robot is controlled locally over BLE through the local workspace BLE SDK. First-time robot selection is performed in Settings; saved-device reconnect is attempted when the foreground runtime resumes.

## Contextual behavior

The optional behavior runtime installs a session-scoped event adapter used by both Realtime transports. The dependency-injected behavior engine owns task/style/game state, candidate choice, request coalescing, staleness and budget accounting; `src/openai/decisions.ts` owns the typed HTTP contract. The runtime adapts these decisions to the existing local controllers and display. Head writes are serialized and canceled by ownership/generation; face candidates are tracked locally with temporary IDs. See [the behavior guide](decisions-behavior.md) for data flow, modes and capability boundaries.
