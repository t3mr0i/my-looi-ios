# Face appearance compatibility — 2026-10-29

The selected moon-eye face and manual eye colors now use one appearance definition in the live face and settings preview. All seven persisted style ids and all five persisted palette ids remain supported. No preference migration or automatic situation-based recoloring is introduced.

## Changes

- `src/character/face-appearance.ts` owns the existing style and palette values, shared eye measurements and idle-mouth selection. Existing reaction mouth shapes still take priority over a style's idle mouth.
- `src/ui/FaceDecorations.tsx` draws the same hats, brows and lashes in the preview and live face. Brow/lash spacing is derived from actual eye-center distance, including avatar dimensions; their vertical placement follows eye height, and live decorations share the eye gaze/breathing transform.
- `src/ui/EyeColorPicker.tsx` accepts the selected style, previews its eye proportions, rotations, mouth and accessories, and uses the live material colors. The preview reserves room for hats.
- Appearance settings put the style disclosure above the preview. Selecting a style closes the disclosure so the result is visible. Existing persistent `updatePreferences` remains the sole writer of style/color choices.
- Palette changes retain the current blink and scene clocks. Changing style can animate its new eye/mouth dimensions without replacing an active scene. The native mouth center remains at stage `(180,216)` for existing prop contacts.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | Passed |
| `pnpm run behavior:expression-test` | Passed, including reactions, heard-speech handoff, stroke/contact ownership, STOP/sleep/lifecycle/reduced-motion guards, actions and scene catalog |
| `pnpm run character:test` | Passed |
| Face appearance regression scripts 128, 129, 143 | Passed |
| Actual component matrix | All 35 style/color combinations; live/settings geometry and material equality, avatar scaling, selected accessories, blink continuity, saved-id preservation and active action recoloring |
| Scene geometry matrix | Seven styles, avatar/fullscreen, all 200 scenes × four phases × three phase positions; 201,600 eye samples with open/half/closed blink and 100,800 mouth samples; finite geometry, stable blink material and mouth viewport bounds |
| Browser | All 35 static combinations visually inspected, representative form transitions at 10% speed, speech, drink and a generic rain scene, all 200 local prop images returned HTTP 200 with PNG headers, desktop and 390px width; no browser errors observed |
| Native | Production React Native face, settings preview and SVG components in an existing Expo review binary, with local fixture stores; iPhone 16 Pro and iPad Pro 11 M4 simulators on iOS 18.5 |

Native captures hold each requested state until its screenshot completes. Eight held states on each simulator cover all seven designs and all five colors: classic/mint, soft/rose, playful/lime curiosity, sharp/violet surprise, cap/violet drink, cowboy/amber affection, bandana/mint speech, and soft/rose sleep. The initial timed attempt was retained under `attempt-timed/` because screenshot latency crossed state boundaries; those filenames are not used as acceptance evidence. A further held rain scene confirmed a generic catalog image and tint in both native simulators. The browser bundle now copies the catalog images into its own output and uses relative image paths. Final held-state acknowledgements are in `output/face-compatibility-2026-10-29/native-verification.json`.

## Inspectable result

`http://127.0.0.1:8771/face-compatibility-2026-10-29/index.html`

The local review page offers all seven styles, five colors, avatar/fullscreen, common expressions, speech/listening/sleep, all 200 searchable scenes and held phase samples. Its 10% toggle slows only eye/mouth form transitions; scene phase timing remains at normal speed. A second view shows all 35 appearance combinations using the actual settings preview component.

Evidence is under `output/face-compatibility-2026-10-29/`, including `all-35-combinations.png`, native contact sheets, screenshots and test logs. `implementation.diff` compares the touched existing files with the fresh task baseline.

## Evidence limits

The full scene/style cross-product is covered by geometry and component checks; every animation was not individually watched by a person. Native evidence uses simulator rendering and mocked services, not real microphone, robot, physical-device performance or a release build. The speech pulse is a display animation, not phoneme synchronization. The review bundle proxy emits inspector websocket handshake errors; native rendering and held-state acknowledgements completed. No commit, push, release or physical-device install was performed.
