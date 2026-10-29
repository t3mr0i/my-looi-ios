# Active objects and coordinated handling

The user's critique was that a normal face plus an unrelated item did not read
as an action. This pass keeps the 200-scene catalog and cyan identity, replacing
independent bobbing with one finite clock for face, hands and held object.

Attention and reaching precede appearance; drawn grippers close around the
object. Drink/coffee lose liquid over two sips, the cookie gains two bites and
bounded crumbs with chewing, and the book opens, turns a leaf and closes.
Contact compensation keeps the rim or straw at the mouth during rotation.
Other props keep their licensed artwork with inspect, offer, cheer, hold, read
or rest handling. Rest has no grippers or playful bounce. This is nine shared
profiles, not 200 individually authored animations.

A scene/phase key prevents an old clock value selecting the next phase's end.
UI worklets sample plain numeric recipes with no catalog lookup, timer loop,
state render loop or new renderer per display frame. All scenes finish within
six seconds. Normal voice, touch and hardware priorities remain. Reduced Motion
returns a static pose for every progress value. Debug fixtures alone can inspect
fixed progress or run at 0.1 speed; normal/model inputs do not expose this.

`pnpm run behavior:expression-test` and TypeScript passed. The new choreography
suite samples all 200 scenes/phases for finite output, continuous prop/gaze
boundaries, mouth contact, liquid/bite changes, page turning, attention before
appearance, bounded lifetime and static Reduce Motion. Controller and actual
RobotFace component checks still cover interruption and priority. All 800
localized picture requests remain display-only.

The offline native fixture imports the actual RobotFace, CharacterProp,
CharacterHeldObject and controller, with camera/voice/robot services mocked.
A fresh iPhone 16 / iOS 18.5 simulator was created after the previous install
stalled. First boot exceeded 45 seconds, then completed. Signing, install and
launch succeeded. A restarted 48-second native capture shows drink, cookie,
book, tea, curiosity and celebration. The drink segment was inspected at 10
percent playback speed and as detailed native frames. The iPad simulator also
installed/launched the fixture and received a scene capture. This is native
display evidence, not physical iPhone/LOOI or microphone-conversation evidence.

The native tablet pass exposed a static-alternative defect: a straw remained
below the mouth. The reduced-motion pose now keeps authored contact too. This
was source-tested across all consumable motifs, re-bundled/reinstalled on iPad,
and inspected directly after a quick-action tap (`ipad-static-ui.png`). The first
post-install capture was still the splash screen and is not pose evidence.

The browser component preview has play/stop, 0.1 speed and fixed-phase inspection.
Cookie/book and 390/320px layouts were inspected. A preview-only layout overflow
was corrected without clipping the native stage. Browser evidence complements
native evidence. No independent human recognition study was conducted.

Evidence in `output/character-object-performance/`:

- `native-full-sequence.mov`, `native-full-sheet.png`: complete native capture.
- `native-heroes.mp4`: cropped native drink/cookie/book playback.
- `native-drink-10-percent.mp4`, `native-contact-detail.png`: slow inspection.
- `native-device.json`, `native-capture.json`, `ipad-attempt.json`: execution.
- `native-ipad-drink.png`: tablet scene capture.
- `expression-tests.log`, `typecheck.log`: source verification.
- `index.html`, `entry.web.tsx`, `build.cjs`: preview at port 53959.

Earlier `native-motion.mov`/`native-interactions.mov` contain URL-opening dialogs
and are not final evidence. Restarting the fixture avoided that dialog. Static
catalog SVG/PNG posters remain motif previews, not exports of the articulated
animated renderer. The previous native installation blocker is superseded by
this successful simulator run; individual unrecorded poses remain unverified.
