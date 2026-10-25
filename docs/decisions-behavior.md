# Contextual robot behavior

The optional behavior layer uses OpenAI Decisions to select small contextual reactions and attention policies. It shares the existing Realtime conversation, local face tracking and guarded robot primitives. It does not replace voice interruption, explicit commands, STOP or the local movement interlocks.

## Enable and inspect

Open **Settings → Robot → Contextual behavior**. Existing installations start with **Off**. Select **Observe** to send decision requests and record their outcomes without changing the robot's behavior or spoken task context; select **Active** for contextual cues and task/game context. Both enabled modes use the API key already saved in the app and incur additional OpenAI usage. The app runs these requests only during an active foreground interaction on the robot's main screen.

The panel provides app-side daily budget presets ($0.25/$1/$3), recorded request/cost/error counters, optional candidate comparison, and a separate switch for assessing explicitly requested camera snapshots. This budget is based on local estimates and returned usage, not a hard provider billing limit: interrupted requests can still be billed by OpenAI. The visual switch never starts periodic cloud camera capture.

## Implemented mechanisms and boundaries

| Mechanism | Product path | Boundary |
|---|---|---|
| Contextual conversation posture | Accepted user turns and audible assistant-turn endings select a posture and one bounded cue or hold. | Realtime continues to own speech timing; there is no word-level gesture synchronization. |
| Pending intentions | Explicit pause/resume/drop and conversational equivalents maintain a bounded local task record and contribute current context to Realtime. | A resumed conversational task never resumes a stopped motor sequence. |
| Coordinated expression | The same cue controls display expression/gaze and an optional head gesture. | Head gestures remain discrete; no exact measured joint angles are claimed. |
| Purposeful search/release | Context can keep the current target, permit a bounded search, or release physical recentering. | Local visibility is detector evidence, not proof of a person's intent or presence. |
| Requested-image assessment | An explicit look command can assess whether its snapshot supports the task before the spoken image response. | Requires Active mode and the separate image switch; no repeated capture or image retention. |
| Familiar rituals and style | Explicit feedback changes device-scoped gesture preferences and greeting repetition. | No person identification or implicit approval from silence. |
| Correction and repair | A correction invalidates the previous reference/cue and updates the interaction context. | No automatic physical object localization. |
| Candidate comparison | The same request can score a small set of allowed next cues against a common rubric. | Model scores are preferences, not calibrated physical truth. |
| Group attention | Native face candidates receive temporary local track IDs; the selected target stays stable across ordering/size changes and can be chosen by context. | Tracks are not identities; there is no reliable speaker-to-face association. |
| Shared expectation/game | An explicitly started number game keeps a deterministic local answer, remaining attempts and outcome; Realtime voices the current game state. | The initial game is intentionally bounded to numbers 1–3, not open-world manipulation. |

Examples in the supported conversation languages include “Let's play a guessing game”, “Stop the game”, “Let's continue”, “Don't nod so much”, and their Russian/Ukrainian equivalents. The settings panel can also start/stop the number game during an active session. Learned preferences, pending intentions and usage survive process restart; live tracks, images and queued physical actions do not.

## Timing and interruption

Semantic requests are single-flight and coalesced. New turns, explicit commands, backgrounding, sleep and stale sessions invalidate pending effects. A cue's freshness deadline limits when it can start. An already started head macro gets at most a short bounded closing phase, while owner preemption, STOP or a newer interaction still cancel every remaining step. All head writes share one serialized owner with explicit commands taking priority over social, behavior and ambient gestures.

Local face tracking remains frequent; cloud questions are triggered by semantic events or meaningful candidate changes. The native face timestamps and JavaScript receipt times are not directly subtracted across clock domains. The Realtime-PCM path uses an additional visual-request generation to prevent a photo or assessment from a superseded request from starting an old response.

## Data and verification

Enabled Decisions requests contain the recent relevant transcript, bounded local task/style state, robot/interaction status and temporary face-candidate metadata. Requested images are sent only with the separate opt-in. The local trace retains bounded metadata and usage; image bytes are not persisted by the behavior layer. Clearing learning removes learned style/task/game data while preserving usage and the daily budget ledger.

The design and research rationale is in [the investigation](research/decisions-verhaltensarchitektur.md). Software regression results and native-build status are recorded in the implementation report. Human judgments of naturalness, real API tail latency, physical calibration and a real robot acceptance run remain separate measurements.
