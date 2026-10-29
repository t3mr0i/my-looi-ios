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

Speaking expressions in Realtime PCM use a second, low-priority Vosk recognizer
only when the response language matches an already-loaded local model. It shares
that model, consumes the same gained PCM bytes as playback, and emits final
word times. A sentence reaches `heardSpeechText` only when those words exactly
match the final assistant transcript, pass the confidence and timing checks,
and the native playback head has passed their end time. The response allows at
most two expression updates. A missing model, language mismatch, failed match,
or recognizer overload leaves the face neutral. Barge-in and playback errors
invalidate the response immediately.

Realtime WebRTC exposes remote media tracks without the app's assistant-output
PCM stream or sample playhead, so transcript streaming is not used as an
expression timing estimate; this transport remains neutral for speech moods.
Budget TTS uses a known-text sentence-clip contract rather than local output
recognition. It requests at most three bounded clips. Because each clip's requested text is known exactly, the
first two sections are exposed when the native player reports that clip has
started, then cleared when the clip finishes or the turn is interrupted.

Completed Realtime input transcriptions are also checked by a narrow deterministic parser for explicitly addressed physical commands (for example, `LOOI, move back` or `LOOI, nod`). Those commands are executed locally through the existing robot safety controller; the Realtime model is not given autonomous movement tools. Forward/backward motion is time-bounded while Realtime retains sole microphone ownership.

Realtime WebRTC is retained only as an Advanced fallback/A-B path.

An opt-in `budget` mode uses the same conversation router and foreground ownership gates:

```text
Shared AudioStudio feeder (16 kHz mono)
  -> local Silero VAD + Whisper STT
  -> bounded text history and relevant local memory
  -> GPT-6 Luna Responses API
  -> GPT-4o mini TTS Speech API
  -> output-only native PCM stream (iOS), buffered Expo player on older builds/other platforms
```

On iOS builds with output-only playback support, Budget explicitly requests
streamed PCM16 at 24 kHz through Expo Fetch. Complete samples reach the native
player before HTTP EOF. Output startup and teardown are asynchronous, never
start capture, and retain a generation-specific owner across native drain/error
callbacks. The client caps total bytes and keeps roughly two seconds queued;
network stalls and playback duration remain bounded. It resumes microphone
capture only after output cleanup. Older native builds and Settings voice
previews retain the existing WAV/Expo player path. This is a compatible
playback capability check, not a provider retry or a conversation-mode change.

The local VAD explicitly allows twenty seconds of speech, matching the Budget turn cap; its native five-second default can otherwise emit a completed segment inside a longer contribution. The one-second endpoint silence is retained.

The feeder is stopped before text generation and cloud playback, then restarted after playback. This mode handles one turn at a time; tapping aborts the outstanding request/player and begins a fresh local turn. Lifecycle epochs invalidate old VAD, STT, model and playback completions. Stop/start operations serialize capture transitions, and the existing router closes Budget on navigation, sleep, memory mutation and backgrounding. Empty local STT results do not reach the text API.

Only memory search, explicit personal-memory storage and language-setting tools are exposed to the text model. Local parsing intercepts STOP, nod and sleep; wheel movement/turn/dance commands are refused because continuous voice STOP capture is unavailable during Budget output. Photos and shared rituals remain Realtime-only. The shared Speech API helper also supplies Settings voice previews and owns cancellation, byte limits and player cleanup for both callers. It preserves the selected cloud voice, style and speed and has no automatic provider fallback.

The Speech API backend is explicitly temporary: OpenAI's published shutdown for `gpt-4o-mini-tts` is January 6, 2027. The UI displays this date and keeps Realtime as the default. No extra native speech dependency is required.

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

## Hermes background tasks

The Agent tasks route uses a versioned single-owner HTTPS facade over a pinned
Hermes Python runtime. Client-assigned UUIDs are journaled before PUT; retries
reuse the exact identity and payload. The journal is encrypted with MMKV AES-256
and a device-only Keychain key. Connection secrets live separately in SecureStore.
The production transport uses `expo/fetch` streams, refuses redirects and aborts
responses above a byte limit. Focus/foreground polling loads cursor-paged task
summaries; full results load separately with stale-response guards.

The server owns a SQLite queue on a persistent volume. Each job uses an
isolated process with a bounded deadline and a search-only tool allowlist.
Cancelling retains the worker slot until process exit. Restart marks in-flight
work interrupted and does not replay it. Terminal deletion preserves a UUID-only
receipt so a lost response cannot recreate that job. A single active server is
required for this storage design. [Deployment and lifecycle](hermes-agent.md).

This route handles explicitly submitted tasks; it grants no automatic access to
memory, audio, camera or motors and creates no scheduled jobs or notifications.
Both Realtime transports expose task submission and status/result retrieval to
the current spoken turn. Submission uses the complete current transcript, not
other conversation turns. A pending admission retains its original UUID and text;
an explicit retry reuses them. Results are read on request, not announced
automatically.
The worker can prepare a plan or research with public search, but cannot perform
external actions. Normal Realtime/BLE operation does not require the service.

## Wake and safety

The wake/command pipeline remains local. Shared microphone handoff is deliberately serialized before Realtime capture begins. Screen-off/background transitions stop sensitive runtime activity.

Robot movement always retains STOP, deadman, BLE lifecycle, and directional cliff-safety guardrails.

## Robot transport

The physical robot is controlled locally over BLE through the local workspace BLE SDK. First-time robot selection is performed in Settings; saved-device reconnect is attempted when the foreground runtime resumes.

## Contextual behavior

The optional behavior runtime installs a session-scoped event adapter used by both Realtime transports. The dependency-injected behavior engine owns task/style/game state, candidate choice, request coalescing, staleness and budget accounting; `src/openai/decisions.ts` owns the typed HTTP contract. The runtime adapts these decisions to the existing local controllers and display. Head writes are serialized and canceled by ownership/generation; face candidates are tracked locally with temporary IDs. See [the behavior guide](decisions-behavior.md) for data flow, modes and capability boundaries.
