# Display actions with props

Implemented four bounded scenes: drink, coffee, cookie and book. The existing
RobotFace shows reveal, use, enjoy and put-away phases over roughly 3–4 seconds.
Mouth, lids and display gaze respond to the prop; no motor command, extra model
request, sound or microphone is owned by the scene. The Home menu contains a
collapsed “Kleine Aktionen” group with four labelled actions.

## Artwork

Original Lucide cup-soda, coffee, cookie and book-open paths, pinned to commit
`c2dd25753da3f25d9ddc351ddb0ee72332189692`. They are bundled SVG files rendered
by the existing expo-image module, tinted to the face palette. No emoji font,
runtime download or new package is required. Original ISC notice and upstream
Feather notices are retained in `assets/character-props/LICENSE`.

Sources: https://lucide.dev/icons/cup-soda,
https://lucide.dev/icons/coffee, https://lucide.dev/icons/cookie,
https://lucide.dev/icons/book-open,
https://github.com/lucide-icons/lucide/blob/main/LICENSE,
https://docs.expo.dev/versions/v56.0.0/sdk/image/.

## Trigger and ownership

An anchored local parser handles explicit DE/EN/UK/RU requests. Committed
Realtime user turns queue through the existing session-scoped behavior event
seam. Assistant completion releases that scene only for the matching session;
the conversation's real speaking/processing flags still gate its start. Budget
uses the same request/reply functions after transcription and completed speech.
With TTS disabled, completion of the text reply releases the action.

There is one replaceable scene, with no accumulating queue. Pending requests
expire after 30 seconds. New user speech, STOP, session changes, corrections,
screen contact, sleep, motion, background and route loss discard it. The runtime
has no dependency on an enabled Decisions engine. Reduce Motion uses a fixed
prop position and immediate static face changes.

## Validation

`scripts/character-actions.test.mjs` exercises actual parser, controller, face
priority and lifecycle adapter with controlled stores/time: four languages,
negative/passive/quoted requests, matching reply ownership, bounded phase
completion, replacement, stale callbacks, expiry, and control/lifecycle
cancellation. RobotFace rendering tests verify prop/face priority, retirement,
fixture isolation and Reduce Motion propagation. Budget integration tests check
that pending playback does not release the prop early. These are local tests;
they do not establish microphone recognition or physical-device acceptance.

Native visual evidence is recorded separately under
`output/character-props-native-review/` using the real RobotFace, CharacterProp,
HomeMenu and scene controller in an offline iPhone simulator fixture. Voice,
camera and robot services are substituted. This is simulator presentation
evidence, not a full live conversation.

Final checks: `pnpm run ios:check` passed, recorded in
`output/character-actions-final-ios-check.log`. The expression group and direct
Budget playback ownership check passed as well. Native evidence includes the
four complete scene cycles, a real HomeMenu expand/scroll/book selection, and
an unclipped 92×70 avatar with the rose palette. The menu row press state uses
static style arrays so the native CSS interop path preserves its row layout.

Review artifacts: `iphone-actions-preview.mp4` (all four scenes, real speed),
`four-actions-overview.png` (cropped native frames), `iphone-actions-menu.png`
and `iphone-avatar-rose.png`, all in the native review folder above. Reduce
Motion is verified in the actual RobotFace component test and the pure prop
pose contract; no new OS-level Reduce Motion acceptance is claimed here.
