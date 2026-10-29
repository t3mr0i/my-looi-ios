# Contextual robot behavior

The optional behavior layer uses OpenAI Decisions to select small contextual reactions and attention policies. It shares the existing Realtime conversation, local face tracking and guarded robot primitives. It does not replace voice interruption, explicit commands, STOP or the local movement interlocks.

## Enable and inspect

Open **Settings → Robot → Adaptive behavior**. Installations without a saved preference start in **Active**. A previously saved **Off** or **Observe** choice is preserved. Select **Observe** to send decision requests and record their outcomes without changing the robot's behavior or spoken task context; **Active** enables contextual cues and task/game context. Both enabled modes use the API key already saved in the app and incur additional OpenAI usage. The app runs these requests only during an active foreground interaction on the robot's main screen.

The panel provides app-side daily budget presets ($0.25/$1/$3), recorded request/cost/error counters, optional candidate comparison, and a separate switch for assessing explicitly requested camera snapshots. This budget is based on local estimates and returned usage, not a hard provider billing limit: interrupted requests can still be billed by OpenAI. The visual switch never starts periodic cloud camera capture.

Physical head cues also require a connected robot and an ambient-motion setting other than Off. Group attention requires the existing Camera Attention option and camera permission. Without these capabilities, the behavior layer can still provide display cues and conversational task/game state.

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

Examples in the supported conversation languages include “Let's play a guessing game”, “Stop the game”, “Let's continue”, “Don't nod so much”, “Greet me with a nod”, “Stop greeting gestures”, and their Russian/Ukrainian equivalents. Explicit greeting agreements retain their source, selected motif and repetition cooldown; device-wide nod suppression still takes priority. The settings panel can also start/stop the number game during an active session. Learned preferences, pending intentions and usage survive process restart; live tracks, images and queued physical actions do not.

## Shared experiences and one-shot curiosity

Character now has three separate timescales: a persisted gentle-curious core,
slow device-local relationship development, and temporary interaction energy and
mood. An actual accepted Home face stroke can contribute to familiarity; a
model tool or its own reply cannot manufacture a stroke. Confirmed positive
shared-episode reports also contribute. Only one rolling 24-hour relationship
day counts, with 32 bounded day records. Repeated tapping, ordinary conversation
volume and absence cannot accelerate or penalize the relationship. Familiarity
changes the existing stroke presentation duration and spoken ease. Quiet energy
suppresses an otherwise optional exuberant cue, while explicit rituals retain
their existing ownership and cadence. It grants no new movement authority.

The short energy state survives restart and recovers over idle time; it is
symbolic interaction energy, never the robot's battery level. Explicit calm
style and serious/negative current content take priority. Realtime and Budget
share the core and life context, and Budget delivery also uses the current
restrained/content direction. Forgetting removes an episode's relationship
references; clearing learning resets relationship, energy and style. Existing
profiles start with an empty relationship history rather than inferred past
affection. See the continuity guide for authored thresholds and test limits.

Stored conversation tone and slowly learned familiarity are character state,
shared by Realtime and Budget even when adaptive behavior is Off or Observe.
Only Active adds positive learning evidence. Three explicit positive reports
about one confirmed named episode, in different sessions at least 24 hours
apart, establish a small familiar interest. It influences only a relevant current
turn. Explicit corrections can stop that interest without deleting its episode.
The [character continuity guide](research/personality-continuity-2026-10-28.md)
documents supported phrases, provisional thresholds and verification limits.
Direct questions such as “What do you enjoy?” use a read-only overview of the
robot's own learned interests in either speech mode. It returns up to three
labels and the total, distinguishes an empty profile from an unavailable read,
and creates no learning evidence or ritual. Human preferences remain separate.
Short retrospective feedback such as “That was really fun” can use one fresh,
unambiguous user or completed audible robot reference from the same session.
Early familiarity permits tentative curiosity; a recent disappointing attempt
temporarily softens the current reply without erasing an established interest.
These conversational moments expire locally and are not persisted.
On a pure greeting after quiet time, an established interest may also supply one
brief optional personal touch. Concerns and ongoing tasks take priority. A
device-wide daily cadence is saved only after that personal touch was heard;
preparing instructions does not count. This starts no unsolicited speech or
new physical action.

In Active mode, LOOI can propose a short shared experience from the current conversation, then asks once whether to remember it. It is saved only after a clear affirmative reply; silence, a correction, or any other response leaves it unsaved. The device keeps at most eight confirmed notes, including a title, detail, outcome, gesture motif, timestamps and a short exact quote from the user turn that supported the note. The quote is available to the behavior context when relevant, alongside the existing transcript/context sent to OpenAI in enabled modes. Pending proposals are not persisted. Users can remove a note directly in Adaptive behavior settings or clear all learned behavior and notes together. Either mutation ends the current conversation and clears its active transcript through the same local-memory mutation gate, so stale transcript text cannot restore a removed note.

For example, after “We called the rocket Gerda, and it finally flew,” LOOI may ask, “Should I remember that we called the rocket Gerda and it finally flew?” A clear “Yes” saves the note. Russian and Ukrainian turns use the same confirmation flow: “Мы назвали ракету Гердой, и она наконец взлетела” / “Запомнить, что мы назвали ракету Гердой и она наконец взлетела?” and “Ми назвали ракету Гердою, і вона нарешті злетіла” / “Запам’ятати, що ми назвали ракету Гердою і вона нарешті злетіла?” A later recall requires the user to clearly name the saved title; the robot must not invent a result or imply an unobserved physical success.

Small curiosity is a separate opt-in. It requires Active mode, the curiosity switch, and an image that the user explicitly asked LOOI to inspect with **Allow requested snapshots** enabled. LOOI may ask one short question grounded in that authorized view, such as “Should it fly or stay on display?” It does not take another picture, ask again when the person is silent, or retain image bytes in companion memory. Russian and Ukrainian examples are “Пусть она летит или останется на витрине?” and “Нехай вона летить чи залишиться на полиці?” An ignored question expires; the opportunity is one-shot and cooldown limited.

## Confirmed object descriptions and shared rituals

For a saved episode, LOOI may propose a short text description of an object that is visible in a snapshot the user explicitly asked it to inspect. The description is saved to that episode only after a clear spoken confirmation. A later explicitly authorized snapshot can be compared with the confirmed description. This comparison is a tentative semantic-model hypothesis about the descriptions, not biometric recognition, a persistent object ID, or proof that the same physical object is present. Uncertain comparisons stay uncertain, and LOOI asks before treating a proposed match as shared context. The settings list shows the confirmed text description and an in-progress comparison or signal wait when one exists. Image bytes are not saved in the episode or companion memory.

A shared ritual is prepared only when the user explicitly names a saved episode and chooses its start signal. Voice remains available on every runtime. If the user agrees to open-palm start, the existing Camera Attention preference and camera permission must be active; there is no separate always-on hand switch. The app first checks a hand image, then looks for an open palm held for one second, entirely on-device, during the ritual's 20-second start window. Older native builds and Android camera runtimes without local hand-signal support use the agreed voice signal instead. Accepting the signal starts only a short spoken count-in; it does not mean that an object moved or that a physical outcome succeeded.

### Activity-linked local region

In Active mode, the existing object-selection sheet offers an optional link to
the current confirmed shared activity. Checking it captures that exact session,
task, episode, title and reference version; the user-selected local region receives
the link only after tracking has started successfully. A changed or expired
activity rejects the selection or ends the link. Tracking loss, STOP and the
bounded tracking lease clear it as well. The link is temporary and is not saved.
Camera frames stay in the local tracking path; this reference does not establish
object recognition, persistent identity or a successful physical outcome.

While the link is current, LOOI may glance at the region once during checking,
preparing or awaiting a result: after 500 ms of quiet, for up to 700 ms, then back
to the person. Speech, processing, pending confirmation and other phases keep
person gaze. These are provisional design timings. The local gaze changes create
no additional Decisions requests or motor cues. The
[joint-attention implementation report](research/joint-attention-implementation-2026-10-26.md)
records integration evidence and the remaining native, tracking and human checks.

### Implementation and acceptance

The curiosity switch defaults off and is stored with the behavior settings. Snapshot permission remains a separate opt-in. Episode storage is device-local and bounded; individual Forget and Clear learning remove saved notes. Both run through the local-memory mutation gate, end the current conversation and clear its active transcript. Acceptance requires confirming that an unconfirmed proposal never survives restart, a confirmed episode can be recalled only by a unique named title, and deleting one or clearing learning removes the intended notes and transcript. A failed mutation must leave an accessible localized error and permit a retry. Curiosity acceptance requires the explicit image grant, one question at most, no second capture or follow-up after silence, and no offer when either opt-in is off. Visual-memory acceptance requires explicit confirmation before saving a description, no persisted image bytes, and an uncertainty state when semantic comparison cannot support a useful hypothesis. Open-palm acceptance requires a per-ritual explicit signal agreement, an active 20-second window, local one-second palm recognition after the hand check, and voice fallback when the runtime is unsupported. These are software acceptance conditions; they do not establish that a person found the robot more natural or that a physical object moved successfully.

## Timing and interruption

Listening, thinking, speaking, reaction and settling now share a local interaction
phase. Listening and thinking expressions appear without waiting for a model
request. An input-side Decisions cue changes only the display; the heard output
can use the turn's one physical head beat. A confirmed positive outcome referring
to a shared episode may use its stored motif immediately, still within the same
one-beat limit and cooldown. The output decision receives the actual heard
assistant transcript separately from the latest user text. Starting audible output
invalidates a late input cue; a completed reaction settles after its bounded phase.

The offline rehearsal accepts its synthetic input, then simulates a heard answer
before checking the physical mock cue. It exercises the same output-side policy
without adding a second decision or driving the wheels.

In the live runtime, an approved physical cue now shares one local expression
score across eyes and head: a small 150 ms gaze preparation, the existing guarded
head macro, then a 220 ms return to current attention. Preparation is skipped
when the original cue deadline is too close. Reduce Motion omits the added
spatial display phases. These are provisional authored timings; the
[research and verification report](research/state-of-the-art-expression-2026-10-26.md)
separates software evidence from native and human evaluation still to perform.

Semantic requests are single-flight and coalesced. New turns, explicit commands, backgrounding, sleep and stale sessions invalidate pending effects. A cue's freshness deadline limits when it can start. An already started head macro gets at most a short bounded closing phase, while owner preemption, STOP or a newer interaction still cancel every remaining step. All head writes share one serialized owner with explicit commands taking priority over social, behavior and ambient gestures.

Input and face-selection decisions stay fresh for at most 800 ms. A reaction
after audible output ends has up to 1,800 ms, capped by the configured request
timeout. Queueing and rate spacing consume that window; neither starting the
request nor receiving its answer extends it. Speech never waits for Decisions.
The [timing verification](research/decisions-timing-2026-10-26.md) records the
reproduced failure and bounded correction. This window is a compatibility limit,
not a measured guarantee of API response time or naturalness.

Local face tracking remains frequent; cloud questions are triggered by semantic events or meaningful candidate changes. The native face timestamps and JavaScript receipt times are not directly subtracted across clock domains. The Realtime-PCM path uses an additional visual-request generation to prevent a photo or assessment from a superseded request from starting an old response.

Ordinary Realtime turns keep automatic responses from the selected endpointer.
Settings offers the accepted fixed one-second pause and a semantic turn-completion
mode. The selection applies at the next conversation start and stays fixed for
that session across context updates and recovery. Semantic mode uses the existing
audio stream and may wait longer for an unfinished thought; it is a configurable
capability, not a measured latency or naturalness improvement. The fixed profile
remains the default pending actual multilingual/far-field comparison. Both keep
interruption enabled. See the
[turn-taking research and verification](research/semantic-turn-taking-2026-10-26.md).

Local authoritative flows such as the number game and reference repair can switch
to manual responses so the app updates state before creating an answer. Starting
and finishing the game update session instructions before the explicit response;
finishing restores automatic response creation without changing the selected
endpointer. A delayed transcript received while the person is speaking again
cannot start an additional game response or a new Decisions request.

## Data and verification

Enabled Decisions requests contain the recent relevant transcript, bounded local task/style state, robot/interaction status and temporary face-candidate metadata. Requested images are sent only with the separate opt-in. The local trace retains bounded metadata and usage; image bytes are not persisted by the behavior layer or companion memory. Clearing learning removes learned style/task/game data and confirmed shared experiences while preserving usage and the daily budget ledger.

The design and research rationale is in [the investigation](research/decisions-verhaltensarchitektur.md). Software regression results and native-build status are recorded in [the implementation report](research/decisions-implementation.md). Human judgments of naturalness, real API tail latency, physical calibration and a real robot acceptance run remain separate measurements.

The three liveliness changes and their current verification are recorded in the
[liveliness implementation report](research/lebendigkeit-implementation-2026-10-26.md).

The face also provides brief local correction feedback, playback-owned speaking
sections, a friendly display-only stroke and bounded expectation/success cues
for the number game. Their source ownership, interruption rules and verification
are recorded in the [expression interaction report](research/expression-interactions-2026-10-28.md).
The game face never receives the secret number. Unsupported speech alignment
stays neutral; generated transcript text is not used as proof of heard speech.
