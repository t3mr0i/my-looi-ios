# Expressive Soft Glass in the native app

The approved `output/soft-glass-expressive-2026-10-28` study is now implemented
by `src/ui/GlassFace.tsx` and the pure geometry adapter
`src/character/glass-face.ts`. `RobotFace` still owns presentation resolution,
attention, blink, speech pulse, touch and the shared action clock.

## Visual implementation

- Full-size eye slots grow from 106×92 to 142×144 points. The gap becomes 52,
  keeping centers at ±97. The viewport scaling remains in RobotFace.
- Eight corresponding contour points support pillow, round, asymmetric bean,
  concave joyful arc, displeased wedge and tender forms. Existing emotions
  select these forms; there is no second emotion or interaction controller.
- Native SVG gradients, caustics, reflections and soft halos create the glass
  material. Cyan's stored id now selects the approved mint/blue glass treatment;
  rose, lime, amber and violet keep their own hues. Preferences are not migrated.
- Bloom uses radial gradients and faint contour layers. Native testing exposed
  a collision between SVG filter URL strings and React Native 0.85's CSS filter
  conversion. Removing filter props fixed those runtime diagnostics while
  retaining the glass light treatment; no raster fallback is involved.
- Reanimated morphs the numerical pose on the UI thread. Blink only changes the
  aperture and fades the material near closure. Sleep and affection show clean
  closed curves without luminous-core remnants.
- The existing attention target drives the interior core and a smaller shell
  displacement. Action-owned reading gaze remains owned by the scene clock.
- The mouth uses a single morphing contour for line, smile, frown and round
  forms. Its full SVG is absolutely positioned so flex layout cannot shrink it
  to the small anchor slot. Its center remains at full-size stage y=216,
  preserving sip/bite contacts. Speech still uses the existing display pulse,
  not an audio-alignment or phoneme claim.
- Avatar dimensions and the seven existing style ids remain available. Hats and
  decorative details move upward to fit the larger eye envelope.

## Preserved boundaries

The integration does not edit face-expression priority, conversation or audio
runtimes, the stroke recognizer, scene controller, prop art or choreography.
Sleep, heard speech, pipeline/feedback, actions and reactions retain their
existing arbitration. The idle smile is restricted to neutral/attentive poses.
Reduced Motion, app/route focus and sleep still disable ongoing face motion.

Dependency: `react-native-svg@15.15.4`, the version recommended by the installed
Expo SDK 56 bundled-native-module manifest. The package lock and local CocoaPods
installation include RNSVG. iOS native dependencies need rebuilding after this
addition; updating only a Metro bundle in an older binary is insufficient.

API references: [React Native SVG usage](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md)
and [Reanimated animated styles and props](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/animating-styles-and-props/).

## Verification

Evidence lives in `output/native-soft-glass-integration-2026-10-28/`.

- TypeScript: `pnpm exec tsc --noEmit` passed.
- Native iOS Debug build for the ARM64 simulator passed with RNSVG linked
  (`native-arm64-build.log`). The first concurrent generic build encountered
  missing Debug React symbols; a consistent ARM64 rerun resolved it without
  changing app or audio behavior.
- `character:test` and `behavior:expression-test` passed, including heard-section
  ownership, stroke/tap ordering, correction/game feedback, all 200 scenes,
  800 localized scene selections and shared prop/mouth contact choreography.
- `glass-face.test.mjs` verifies distinct contours, asymmetric curiosity,
  unchanged glass/core geometry during blink, complete sleep/pet closure,
  inherited speech pulse and finite geometry through all scene phases.
- The actual RobotFace component test executes the real GlassFace against mocked
  platform boundaries. It covers Reduced Motion event/query races, speech/prop
  takeover, fixed mouth contact, unshrunk SVG size, avatars and five palettes.
- Existing face skin/palette regressions 128/129, the 18 lifecycle checks and
  package-lock graph audit passed.
- A browser review bundles the actual production components and controller,
  isolating sensor/voice/robot services. Phone-sized views show curiosity,
  surprise and the unchanged straw/mouth contact; console warnings/errors were
  empty. This is component evidence, not a physical-iPhone audio test.

The native simulator review completed a 57-second sequence through readiness,
curiosity, surprise, joy, affection, speaking, drink, coffee, snack, reading,
sleep and return. `native-verification.json` records install/launch/capture and a
native cache-file mount signal. `native-sequence.mov` preserves the full capture;
`native-animation.mp4` trims launcher startup. Drink contact, open book, coffee,
snack and sleep stills were extracted from the actual video during their use
phases. The direct `native-sleep.png` lands on the return boundary; use
`native-sleep-held.png` for the held sleeping pose. The runtime no longer logs
`FilterPropsConversions` failures. Earlier launcher/menu/marker attempts are
separate subfolders and are not acceptance evidence.

The review uses the real native components and shared action controller with
local service fixtures, through a local Metro bundle. It has a separate bundle
identifier and does not change the normal app's stored preferences. Its
recorded speaking stage tests display ownership, not microphone or audio output.

The repository contained extensive existing work. A per-file baseline under the
evidence directory separates this integration from those earlier changes.
No release, physical robot operation or external voice session is part of this
change. A real iPhone check of rendering performance and live audio remains open.
