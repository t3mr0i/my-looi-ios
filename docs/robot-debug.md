# Robot connection and local debugging

Open **Settings → Robot → Robot debug**, or **Robot debug** in the initial setup.
The dedicated screen works before API-key entry, model downloads and microphone
permission. The app supports portrait and landscape; setup scrolls with the
keyboard visible.

While this screen is open, the app temporarily pauses its microphone and camera
runtime so offline debugging does not compete with voice, gaze or iPhone screen
sharing. Controls become available after that pause completes. Leaving debug
releases the pause; normal media resumes when the app is foreground and awake.
Permissions, saved settings and the robot connection are retained.

Choose a connection mode:

- **Hardware** uses the saved physical LOOI and the usual Bluetooth discovery.
- **Mock robot** uses a local simulated transport. Its connected switch can
  reproduce a connected robot or a lost link without any Bluetooth device.
- **Disconnected** blocks robot connections and commands, including automatic
  reconnect. A saved physical robot selection is retained for later use.

The selected mode and requested mock-link state persist. Returning from the
background reconnects a mock only when its connection is still requested. Mock
mode is labeled on the main screen and in Settings, so simulated connection
status cannot be mistaken for a physical Bluetooth link.

## Controls and scenarios

Manual tests cover nodding, head positions, light, bounded forward/turn commands
and STOP. Their state and the latest commands appear in the screen's activity
history. The history retains at most 120 entries and displays the latest 12;
repeated motor frames are coalesced. It contains protocol actions, not API keys
or conversation text.

**Clear floor**, **Front edge**, **Rear edge**, **Obstacle ahead** and **Unknown
sensors** produce simulated FED9 observations. These run through the actual SDK
and application safety controller. Switching to unknown resets the simulated
connection so old clear readings cannot pass for current evidence. An unsafe
scenario blocks movement with its current reason. Returning to clear still
honors the normal stabilization and edge-recovery rules.

Direct test buttons operate only on the selected, connected mock. Changing modes,
losing a link, STOP and backgrounding invalidate pending commands. Choosing mock
or disconnected does not scan for or select a physical robot.

Only robot hardware is simulated. If a normal conversation is started with an
API key, Realtime and Decisions still make real OpenAI requests and can incur
charges. Manual tests require neither OpenAI nor a microphone. Camera images,
speech recognition, physical mechanics, firmware behavior and actual Bluetooth
timing are not validated by this mock.

## Offline behavior rehearsal

The debug screen also offers **Offline behavior rehearsal**, between sensor
scenarios and manual controls. Connect the mock, expand the rehearsal, choose a
scenario and press **Run rehearsal**. It starts collapsed to keep manual controls
nearby. The result shows the expected cue, the cue selected by the
real behavior engine, gesture attempts and a short trace. Completed head
gestures also appear in the mock activity history.

- **Curiosity** selects a curious look from a scripted question and decision.
- **Celebration** selects a happy bob from a scripted positive outcome.
- **Less nodding** feeds an explicit preference and a simulated nod suggestion;
  the existing policy must override it with hold and make no head writes.
- **Interrupted** interrupts a pending decision before its late result arrives;
  no gesture may execute.

Each run uses a fresh, private engine with deterministic decision answers.
It does not use OpenAI, the microphone, camera, live conversation, saved behavior
preferences, learning or the real usage ledger. It works even when normal
adaptive behavior is Off. Passing proves the scripted policy/controller path;
it does not establish the quality or latency of an actual model decision.

Only the connected mock's existing head-gesture controller is available to the
rehearsal. It never drives wheels. Cancel, STOP, source/link changes, active
driving, backgrounding and leaving the screen invalidate pending effects.
Sensor scenarios continue to test directional drive safety through the manual
controls; head-only rehearsals do not claim a cliff interlock for head motion.

## Live Decisions API check

The separate **Live Decisions API check** starts collapsed. With the mock
connected and its wheels stopped, expand it and select **Send one request**.
This makes one real OpenAI request using the key saved in the app. The exact
fixed sample is shown before sending; no images, recordings or conversation
history are included. It sends no robot commands and does not start a live
conversation.

A valid response shows the three existing choices for gesture, attention and
intention, with confidence, elapsed time and returned token counts. The cost is
an estimate calculated from token usage, not an invoice. Test costs are separate
from the adaptive behavior engine's local budget. There are no automatic retries.
Cancel, STOP, mode/link changes, driving, backgrounding and leaving the screen
abort the current check and prevent its late result replacing a newer result.
Cancelling cannot guarantee that an already sent request is not billed.

This checks one real API response and its validation. It does not establish
behavior quality, a production cue deadline, camera/voice input, or physical
robot response. The offline rehearsal remains the repeatable local policy and
mock-controller check.

## Implementation and checks

The existing `LooiTransport` interface is the seam. The production adapter uses
Bluetooth; `MockLooiTransport` interprets the same handshake and command bytes,
emits simulated sensor notifications and owns its local trace/timers. The
autoconnection module owns mode persistence, serialized switching, lifecycle
cleanup and the source marker. Existing motion and behavior callers continue to
use the same controller and its priorities/interlocks. A disconnected transport
rejects implicit connection attempts as well as writes.

This keeps mode knowledge in connection management and diagnostics rather than
adding mock branches to every gesture. The trade-off is a protocol simulator,
not a physics or perception simulator. The mock deliberately cannot certify the
real robot's motion or stopping distance.

Run `pnpm run robot:mock-test` for SDK transport, connection-mode and full
controller integration checks. `pnpm run behavior:rehearsal-test` checks isolated
policy runs and the real engine → controller → SDK → mock path, including no
network/physical BLE, STOP and source changes. `pnpm run behavior:live-check-test`
uses a fake key and stubbed HTTP to test the live-check contract and cancellation;
it does not make a real API call. `pnpm run ios:check` includes these checks beside
the existing behavior, BLE and lifecycle tests. Device acceptance should also
inspect portrait setup with its keyboard, a manual mock action, a blocked move,
link loss and return from the background.
