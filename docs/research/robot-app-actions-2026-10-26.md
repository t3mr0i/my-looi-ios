# Robot app action mappings — 2026-10-26

## Baseline

Reachy and MicroDuck use different app-level names and request envelopes for
actions. The shared compatibility bridge could dispatch known protocol
messages, but there was no user-managed way to translate an upstream app's
named action to a capability LOOI actually executes. Selecting an app family
would not solve this: the mappings belong to the shared robot action layer.

## Implemented behavior

My LOOI now provides one **Apps → Action mapping** page for both protocols. It
maps exact upstream action names to one of 15 typed LOOI actions: six
expressions, three head positions, four bounded movement pulses and two light
states. Labels are localized. Users can edit, add or remove mappings, save or
reset them, and preview saved mappings. Preview runs a temporary LOOI session
without enabling external app connectivity.

The actual `RobotAppsScreen` and `RobotAppActionsPanel` were exercised on an
iPhone 16 Pro simulator running iOS 18.5. The Apps menu opened Action mapping;
the flow saved `dance → happy_bob` and previewed it, renamed the alias to
`dance_test`, then removed it. The picker displayed all 15 actions in the
expression, head, movement and light groups. The preview showed “Fröhlich
wippen an LOOI gesendet.” The [empty page](../../output/robot-app-actions-preview/actions-empty.png)
and [target picker](../../output/robot-app-actions-preview/action-target-picker.png)
captures show these screens. The earlier
[saved-preview capture](../../output/robot-app-actions-preview/action-saved-preview.png)
shows outdated helper text (“lowercase, 1–64”); it predates exact-name support
and is not evidence of the final 1–200-character copy.

After the Mac was unlocked, the simulator reset gate was completed: Reset all
created an empty dirty draft, explicit Save/confirmation applied it, then
leaving for Apps and reopening Action mapping showed an empty profile with Save
disabled. See the [reset-flow capture](../../output/robot-app-actions-preview/action-profile-reset-verified.png).
This fixture uses in-memory profile state; it does not verify SecureStore UI
read/write on a device. Production runtime tests separately cover resetting a
stored profile to empty and revoking its old alias without controller calls.

The profile is stored separately in SecureStore under
`looi-robot-app-actions-v1`; changing it does not rewrite app connection
credentials or require a network connection. The shared core resolves a name
before normal command validation and execution-lane admission. As a result, a
mapped movement action goes through the same movement lane, sequence guards and
STOP handling as ordinary movement. The generated movement is a fixed 300 ms
pulse; the mapping does not relax validation for raw SI drive requests.
Resolved named gestures use a 3 s core execution lease, and Reachy named-action
tasks use a 3 s task lease so a normal longer controller gesture can finish.
The separate Reachy streamed-frame lease remains 750 ms. Replacing an active
named action revokes its previous lease across lanes. The regression test
confirms that replacing a running wheel action with a head action invokes STOP
before the head action starts. Separate core tests cover STOP invalidation.

The gateway advertises only built-in actions supported by the active backend,
plus configured aliases whose targets remain supported. Invalid profiles,
duplicate aliases, canonical-name overrides and unknown action targets are
rejected. Unknown names have no controller effect.

Sources preserve exact case, internal spaces and punctuation; `Dance Intro.v2`
and `gestures/wave` are valid examples. The mapping page trims pasted outer
whitespace before saving. The persisted profile requires a trimmed printable
source of 1–200 Unicode code points and rejects C0/C1 controls. It accepts up
to 64 mappings. The input permits up to 400 UTF-16 code units so it can accept
200 supplementary-plane characters; shared validation applies the 200 code
point limit. Sources are literal lookup keys and are never executed as code,
URLs or paths.

When stored JSON is corrupt or its schema version is not recognized, loading
falls back to the canonical empty profile and writes the reason only to
diagnostics; SecureStore I/O failures propagate. Action preview rejects while a
Companion launch is pending or a Central session is accepted. It checks both
before and after asynchronous activation, covering a session that starts during
the preview wait.

## Protocol examples

Both adapters use the same saved profile without changing the upstream request
shape. MicroDuck supplies a nonempty `skill` string; Reachy `move_name` accepts
1–200 characters. The profile keeps the same exact name for lookup:

```json
{"jsonrpc":"2.0","id":2,"method":"robot.do","params":{"skill":"dance"}}
```

```json
{"type":"task","uuid":"b021a557-9a97-44f5-ae56-770747c2aa10","timestamp":"2026-10-26T12:00:00.000Z","req":{"move_name":"dance"}}
```

With `dance → happy_bob` saved, both inputs resolve to LOOI's `happy_bob`
gesture. `walk → move_forward` resolves to the bounded forward pulse. These
examples demonstrate the named-action path; they do not certify every Reachy
or MicroDuck app method.

## Verification

Ran these focused tests locally on 2026-10-26:

```text
node scripts/robot-bridge-action-profile.test.mjs
node scripts/robot-bridge-action-runtime.test.mjs
node scripts/robot-bridge-runtime.test.mjs
```

All three passed. The profile test covers canonical actions, aliases,
capability filtering, malformed/duplicate profile rejection, and movement/STOP
lane behavior. The runtime test exercises saved profile persistence,
credential isolation, offline preview, and the unchanged Reachy and MicroDuck
request envelopes through the production gateway, core and LOOI backend. The
controller is mocked at the native LOOI seam, so those tests prove the resolved
commands reach the controller interface and preserve cancellation semantics;
they do not establish physical robot motion or live hosted-app acceptance.

After the named-action lease update, the focused action-runtime and Reachy
tests passed with an 850 ms controller gesture through both app protocols. They
cover replacing a mapped movement with a mapped head action across lanes and
confirm the controller STOP call occurs before the successor head gesture
starts. The runtime suite additionally covers a pending Central peer factory
and activation race, corrupt saved preferences, concurrent profile writes and
reload behavior, STOP during a controller write that resolves late, and
resetting the stored profile to empty (which revokes the old alias without
controller calls). A production-controller test passes the literal
`Dance Intro.v2` alias and a 200-emoji identifier through the unchanged Reachy
wire request. The final full `robot:bridge:test` suite passed after these exact
name changes. The TypeScript check (`pnpm exec tsc --noEmit --pretty false`)
and the action-string localization test passed. The native Release build and
strict code-sign verification passed. The bundled artifact includes
`isRobotAppActionSource`, the action-profile key, action preview, replacement
guard and translation identifiers.

Release 2.1.151, build 41, was successfully installed on the private iPhone as
a data-preserving update; strict code-sign verification passed. The
[redacted install result](../../output/robot-app-actions-preview/install-verified.json)
records the outcome without device identifiers. An earlier install attempt
failed with CoreDevice error 4016, but the subsequent installation succeeded.
Afterward DeviceHub showed the iPhone lock screen, so the release app was not
opened and its on-device UI or live SecureStore behavior was not checked. The
simulator reset gate and installation are complete; physical app acceptance,
camera/WebRTC or upstream-app use, and physical LOOI motion are not established
by these checks.

The broader upstream-app acceptance results remain in the historical [app
acceptance report](robot-app-acceptance-2026-10-26.md). This action-profile test
does not replace or revise that report.
