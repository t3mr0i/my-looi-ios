# Interface polish — 29 October 2026

Mode: **full**. Scope: every Expo Router route and shared UI surface, including
onboarding, the face menu and overlays, conversations, memory, settings,
research, assistant setup/examples/tasks/connections, Apps and action mapping,
robot diagnostics, and the missing-page fallback. The recorded inventory has
50 route/component/support files.

Framework: Expo 56, React 19, React Native 0.85, Expo Router, Reanimated and
react-native-svg. Styling remains the existing `StyleSheet`/NativeWind system
and `looiTheme` dark/cyan palette. Routing/design authority: `docs/ui.md`;
no repository or ancestor AGENTS.md or DESIGN.md was present.

## Findings and changes

All findings below were addressed. Severity describes the original issue.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `DeviceShell` | A fixed side rail consumed phone reading width; long labels crowded their controls. | Bottom navigation below 600pt, wider rail on large displays, bounded label wrapping, scrolling navigation, 1040pt reading cap. | Gives forms and reading screens room while keeping every destination reachable. |
| MEDIUM | Shared controls across setup, settings, memory, assistant, Apps and diagnostics | Some controls depended on text padding or hit slop; pressed feedback varied or was absent. | `InterfacePressable` supplies a 44×44pt minimum and immediate opacity feedback, preserving refs, handlers, custom styles and disabled behavior. | Makes touch feedback predictable without another animation or styling system. |
| MEDIUM | Settings | 12pt help, small inputs, and labels shrunk to fit fixed segments. | 14/20pt help, 16pt inputs, natural wrapping and two columns for long phone labels or larger text. | Keeps choices and technical explanations readable. |
| MEDIUM | Home menu repair row | Problem and recovery instruction were truncated beside one another. | Stacked, complete text and a row that grows with its contents. Sheet radius matches its 16pt inset and row radius. | The user can read both the problem and the next action. |
| MEDIUM | Settings/onboarding selections, disclosures and input fields | Missing roles, checked/expanded states or persistent accessible input names. React Native Web did not expose `accessibilityState` as ARIA. | Explicit radio/checked, expanded and input labels; the shared control also forwards checked/selected/expanded/busy as ARIA. | State is available beyond color and works in the browser preview too. |
| MEDIUM | Menu, image, object-selection and action-picker modals; conversation overlay | Several animations did not explicitly follow Reduced Motion; hidden conversation text remained accessible. | Shared live motion preference for modals; Reanimated system reduction; hidden overlay descendants excluded. Conversation exit is 120ms versus 160ms entry. | Respects motion settings and avoids reading invisible content. |
| MEDIUM | Conversation messages | User text was dimmed by nested opacity; timestamps were smaller and faint. | Equal 16pt body readability, readable 12pt timestamps and selectable message text. | Stored conversations remain easy to read and copy. |
| LOW | Evidence images and numeric displays | Inconsistent image edges/cropping and proportional changing figures. | Neutral 1px outlines, contained chat evidence and tabular figures for timestamps, counters and metrics. | Clarifies image boundaries and stabilizes changing numbers. |
| LOW | Navigation/root HTML/missing-page screen | Navigation could select a light background although the app surfaces are dark; the error screen used the starter theme. | Shared dark navigation/background colors, web font smoothing and a branded, accessible return action. | Keeps route backgrounds and fallback screens consistent. |
| LOW | Hold-to-talk control | 0.94 spring press scale and no explicit accessible label/busy state. | 0.96, 100ms system-aware timing plus the current label and processing state. | Quieter feedback, with the existing hold/release callbacks preserved. |

## Evidence for all five concerns

- **Typography:** inspected screen/card/form styles, language segments, conversation
  text and numeric displays. Previewed 320×740, 390×844 and 1024×768 layouts.
- **Surfaces:** inspected tokens, radii, outlines and hit areas. Measured all 20
  rendered home-menu controls: none below 44×44 CSS pixels.
- **Icons:** retained Expo Symbols/SF Symbols and the existing SVG glyph system;
  navigation uses outline/default and filled/active variants where supported.
  Browser preview symbols and avatar are fixtures, not proof of native rendering.
- **Animation:** inspected every UI `Modal`, timing/spring call and image transition.
  Replayed the home-menu fade and sheet at 10% speed in the disposable preview
  (timings ×10, sheet CSS 300ms → 3s); inspected initial, resting and exit states.
  Emulated Reduced Motion and verified opening/closing without movement.
- **Performance:** reviewed shared control implementation, list rendering and
  animation ownership. Added no per-row hook, layout animation, dependency,
  continuous loop, global clock or compositor hint. Existing scene virtualization
  and catalog paging remain in place.

Rejected candidates: adding animations to every list item would add motion to
frequent interactions; the shared pressed cue is immediate instead. Replacing the
face artwork, props or palette was unnecessary and would interfere with existing
work. `ReminderCard` and `VoiceButton` have no current route references; only the
latter's existing interaction/accessibility implementation was made consistent.

## Verification

Executed in a disposable local React Native Web harness using production screen
components, sample memories/conversations/catalog entries and mocked native/API
boundaries:

1. Open Settings at 320pt, 390pt and 1024pt; inspect wrapped navigation and language
   choices. Verify selected German radio exposes `aria-checked=true`.
2. Expand a conversation and read both message roles and timestamps.
3. Search memories for “Kaffee”, open Edit, inspect Save/Cancel and disabled
   filtering, cancel, then navigate to Settings.
4. Open onboarding and inspect setup steps, input labeling and disabled save.
5. Open assistant examples, show the invented day plan, inspect persistent example
   notice and return controls.
6. Open Apps → App setup → Action mapping → Add → action picker; select a target.
   These operations affected preview state only.
7. Open/dismiss the home menu at 10% animation speed; repeat with emulated Reduced
   Motion. Inspect the complete repair message and selected language semantics.

Passed local checks:

- TypeScript (`tsc --noEmit`) and `git diff --check`.
- UI localization, settings/face/volume and root-layout regression checks.
- Agent workspace/Nous setup and personal-ritual settings checks.
- Memory correction, robot-face accessibility/appearance and input-attention checks.
- Object-selection gesture pin, robot action profile, robot debug integration,
  behavior rehearsal and Decisions live-check checks.
- Production iOS JavaScript/Hermes export (final log in the evidence directory).

Two existing test harnesses were adapted to load the shared control. No business
logic was changed to accommodate a test.

Local evidence and reproducible preview:
`output/ui-polish-2026-10-29/` (ignored build output). It contains source scope,
preview sources, screenshots, touch measurements and iOS export logs. The preview
uses a static face avatar and a simplified Reanimated adapter; its motion test
covers the real HomeMenu React Native Animated fade and web sheet, not the native
face renderer. An initial preview-only translator loop was corrected. A browser
instrumentation MutationObserver error appeared; no production-screen error
remained in the inspected flows.

**Verdict: Approve** for the local polish change; no actionable finding remains in
the inspected scope. Native installation, VoiceOver focus, Dynamic Type, platform
safe areas/keyboard behavior, native animation timing and physical microphone,
camera/BLE/robot acceptance were not exercised in this pass. The production iOS
export establishes bundling, not native compilation or device acceptance.
