# UI principles

The main screen should feel like the robot's face rather than a conventional chat application.

- Keep the primary voice interaction visually dominant.
- Keep persistent controls minimal and immediately understandable.
- Settings should expose technical configuration without turning the main screen into a dashboard.
- Language controls should remain reachable during conversation.
- The face fills the whole screen. A single round menu button appears in the top-right corner when the screen is touched and fades out after a few seconds; it stays visible while a screen reader is active or while something needs attention, such as missing voice models or a robot connection error.
- The menu opens as one bottom sheet with large rows for the robot connection, both languages, sharing a photo, looking at an object, Apps and Settings. Problems appear as the first row of that sheet instead of as floating banners.
- The same menu has a collapsed Little actions group: take a drink, coffee break,
  cookie and reading. Each runs a short face scene, handles a local drawn prop,
  then puts it away. Props use drawn geometry and licensed vector artwork,
  never emoji.
- Settings is one scrolling page ordered from everyday to technical: Robot, Language, Voice, Behaviour, Appearance, AI and account, Local models (only when something is missing), Help and updates, and a collapsed Advanced section that holds debug, turn-taking, the model refresh and previous models, backup, diagnostics and the legacy WebRTC mode.
- Options that pick one value use a full-width segmented control with segments of at least 44pt instead of small chips, and every button keeps a minimum height of 44pt.
- Robot connection, memory, and diagnostics belong in dedicated screens rather than quick-action clutter.
- Advanced rollback/debug options should stay clearly separated from the default experience.

The assistant workflow uses a full-width reading surface with explicit Back and
Back to LOOI controls. First use offers invented examples or setup with a private
connection code. Setup shows the complete server origin and data notice before
contacting it. Manual address/key entry remains secondary. Examples cover a day
plan, readable plain-text email/local drafts and an invitation review; a persistent
Example data label stays outside the scrolling area. Actual research tasks retain
their separate confirmed server states. Google account access is not implied by
either the examples or a successful research-service connection. See the
[connection and UI plan](research/hermes-personal-agent-connections-2026-10-28.md).

The face distinguishes awake readiness from genuine sleep. Deep sleep owns the
closed-eye face; audible speech owns the speaking face, even when an earlier
reaction or a shared activity is still waiting. Speech, processing and sleep
discard suppressed tap reactions so they cannot return afterwards. STOP clears
the current visual reaction. Reduced Motion and route/app focus still govern
display animation.

The face uses the accepted soft moon-eye design: a rounded contour with a
slightly fuller lower half, dark glass above and mint light rising from below.
One offset reflection and a faint rim describe the surface. The default eyes
retain the approved wider spacing and small, broad, tapered smile. The selected
study's contour and smile are represented by the same cubic geometry in the
native renderer and generated scene pictures. Existing face-style ids, hats and
all five palettes remain compatible; color families tint the moon material.

Curiosity, surprise, joy, concern and displeasure morph that glass contour.
Blinking closes an aperture over stable material. Sleep and affection hide the
glass and retain clean closed curves. The small idle smile applies only to
neutral/attentive poses; listening, processing and negative emotions retain their
resolved mouth. Captions do not move the eye row.

The native SVG renderer consumes the existing Reanimated blink, gaze, speech
pulse and scene clock. It owns no conversation, reaction or sensor state. The
lower light follows the selected attention target inside a nearly still shell.
The mouth stays centered at stage y=216 for full-size prop contact. Eye size,
spacing and vertical position scale the accepted study around that contact;
the avatar uses the corresponding small drawing. The mouth pulse remains a
display animation; it does not claim phoneme or audio synchronization.

During longer user turns in the standard Realtime PCM mode, a locally detected
short acoustic pause may show a brief neutral listening accent in the eyes and
drawn face. It means attention, not agreement or understood meaning. It adds no
physical motion or speech. Its duration and frequency are bounded; speech
output, STOP, sleep, focus loss, Reduced Motion, games and pending confirmations
take priority. When the current audio cannot establish a fresh opportunity, the
ordinary listening face remains.

Prop scenes are display-only. Explicit voice requests such as “Hol einen Drink
raus”, “Mach eine Kaffeepause”, “Iss einen Keks” and “Lies ein Buch” queue one
scene until the current reply completes; passive mentions and negations do not
trigger it. English, Ukrainian and Russian commands use the same local parser.
Menu requests work independently of the optional Decisions service. New user
speech, a face contact, STOP, real sleep, robot motion, route loss or background
discards the scene and its pending request. Speech, processing and correction
feedback own the face before props. A pending voice scene expires after 30
seconds and cannot be revived by an old session. Reduced Motion keeps the
prop still and substitutes static face poses. Props follow the face palette and
remain decorative to accessibility; the face announces the current activity.

The 200-scene catalog uses the same face and action controller. Sadness has
raised inner eye corners and a frown; concern uses a smaller frown. Food props
use authored contact points on the upstream vectors, with rotation compensation
so the straw, cup rim or bite edge stays at the mouth during the accent. Reading
has one bounded line scan owned by the action phase; unrelated camera attention
cannot restart it. A teapot is offered rather than lifted to the mouth.
Native props use transparent 384px PNG renders of the preserved source vectors;
palette tinting stays in the component. No emoji font or network image is used.

Actions share one finite clock across the face, hands and held object. Attention
leads pickup; using and reacting have distinct beats. The four quick actions have
articulated drawn objects: drink and coffee lose liquid over two sips, a cookie
gains two bites and crumbs with chewing, and a book opens, turns a page and closes.
Other catalog entries use their existing artwork with handling suited to reading,
offering, inspecting, holding or cheering. Rest profiles stay quiet. These are
display actions with no new sensor, audio or robot action. Speech and STOP retire
the scene. Reduce Motion uses a static held object and face pose.

Curiosity uses an asymmetric look and a small tilt while preserving the existing
attention target. Surprise uses taller eyes and a round mouth. Surprise opens quickly,
satisfaction grows gently and rests, and displeasure settles without a playful
rebound. The drawing area reserves space for the largest rotated eyes and their
glow; only eyelid masks clip the eye shape.

A committed correction has a brief, open, asymmetric questioning face. It
releases the previous object look and returns to the person without a motor
command. A small confirmation smile requires the immediately following explicit
reference confirmation within 30 seconds. Questions, silence, another topic,
STOP, preference changes and a new session cannot stand in for understanding.

Speaking expressions use playback-owned text sections. Generated transcript
deltas do not establish what has been heard. Realtime PCM can reconcile local
output recognition with the native playhead; Budget speech owns a separate clip
for each of at most three sections. Unsupported or uncertain alignment uses a
neutral speaking face. These are section-level reactions, not word-perfect lip
synchronization.

A deliberate, slow single-finger stroke has a short, contented eye squeeze and
smile. It is display-only, available while awake and idle, and has an equivalent
screen-reader action. The same contact never also starts a conversation. Tap,
wake and explicit control interruption retain their existing paths; current
motion and speech controls can consume a contact before the stroke recognizer.
Cancelled or multiple-finger contacts cannot produce affection.

The local number game uses one identical expectant face after each heard
invitation, with a bounded quiet return after 15 seconds. Wrong guesses do not
change that face or reveal the secret. A locally confirmed win receives one
1.1-second success accent after its spoken result ends, then returns to the
current conversation. STOP, a new turn or lifecycle change discards pending
success. A later reply cannot revive it. This adds no motor command or model
request.


## Apps area

Apps uses its own full-width navigation shell; the shared DeviceShell rail is not
shown in this area. This is a scoped structural change inside LOOI's existing
dark/cyan identity. Other routes keep their current shell.

The first screen is Discover. A three-part control switches directly between
Discover, My apps and With AI. The gear opens App setup, which groups connection,
camera/audio and action mapping. Detail pages return to App setup; its Back
returns to the previously selected main section. The existing unsaved action
mapping guard still owns navigation away from its editor.

The connection strip and local STOP stay outside the scrolling content. Phone
layouts use one readable column; wide layouts use two catalog columns inside a
1040pt maximum width. Text and forms use the available width, with 44pt minimum
controls and the normal platform text scaling. Catalog entries lead with title,
author and purpose, then one primary action plus Details. My apps separates
Start/Stop from a quieter trash action with the existing uninstall confirmation.
The catalog loads 60 entries at a time with an explicit Show more action; its
complete shared index remains searchable.

## Conversations and memories

The Home menu lists Conversations and Memory before Apps and Settings. The
Conversations screen offers Agent and Research as two equally sized tiles above
the session list, and the Memory screen filters by category in one horizontally
scrollable row, with Edit as a visible action and Delete as a quiet text action
behind its confirmation.

## Situation picture collection

The Home menu's Little actions group keeps its four quick actions and opens
an in-sheet collection of 200 full face pictures. Ten categories contain twenty
separately curated motifs each. Search and category selection filter a
virtualized two-column grid. Empty search results provide a reset action;
Back returns to the same menu and Close dismisses the sheet. Selecting a picture
closes the menu before the real face scene begins. Thumbnails are pre-rendered
PNG assets; live props remain vector symbols tinted to the current face palette.

All 200 entries have German, English, Ukrainian and Russian labels. Exact
show-me requests select them by localized name. Clear current-human phrases
may select a quiet contextual picture after the matching reply completes, at
most once every twelve seconds. The local number game keeps its own face.
Negations, quoted examples, reported speech, definitions, conflicting topics and
unclear matches retain a neutral fallback. Negative emotional situations retain
appropriate expressions throughout their final phases. System, agreement and
understanding pictures have no automatic text triggers. A displayed status
symbol never establishes a measured state or a confirmed understanding.
