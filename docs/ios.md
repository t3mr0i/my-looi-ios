# Building and validating the iOS port

My LOOI keeps Expo, React Native and the shared TypeScript application. The iOS
port adds local Expo modules in `modules/*/ios`. Generated root `ios/` files are
not authoritative source and must not be committed.

## Current status

On 25–26 October 2026, both the unsigned Debug ARM64 simulator build and a signed
Release iPhone build completed with Xcode 27.1 and CocoaPods 1.16.2. The Release
app (2.1.151, build 41) was installed on the user's iPhone 16 running iOS 27.0.
The TypeScript/logic checks and iOS JavaScript/Hermes export also pass.

Installation exposed two native startup issues that compilation alone did not
detect: shared OpenFST C++ symbols in Vosk/Sherpa, and the SDK 56 template's
missing scene lifecycle under iOS 27. The build adaptations are documented
below. The corrected Release app now starts and displays onboarding on the
physical iPhone. Returning from the home screen and opening the setup deep link
also works. Portrait setup has completed on the device, including local speech
models and microphone permission. The OpenAI key remained configured after an
app update and restart; the authenticated model-list request succeeded. The mock
robot menu exercises the production controller without physical hardware. The
dated [iPhone mock acceptance report](research/iphone-mock-acceptance-2026-10-26.md)
records the executed UI checks. Adaptive behavior is set to Active, requested
visual decisions and camera attention are enabled, and the user-authorized camera
permission is granted. Actual Realtime/Decisions responses, microphone/camera
processing, audio/AEC and physical BLE/robot behavior still require acceptance;
no physical LOOI is available yet and no firmware is recorded.

The remaining-source pass added shared camera permissions, native iOS simulator
constants, RSS/thermal diagnostics, capture-only compatibility through the shared
PCM engine, and startup/suspend serialization. Logic tests cover competing audio
clients, failed acquisition/teardown, denied permissions, missing runtime modules,
event forwarding, suspended timers and a background transition during startup.
The latest independent regression inventory has 63 successful invocations out
of 67; the only four failures are the Android baseline gaps listed below. Some
checks appear in more than one test chain, so these are not 67 distinct test
cases. The expanded `ios:check` chain passes TypeScript and the chained logic
checks, including mock transport, connection-mode isolation and controller integration.

The primary conversation implementation is `RealtimePcmAudio`: one AVAudioEngine
with VoiceProcessingIO, a 16 kHz mono PCM16 capture contract and app-owned 24 kHz
playback. AVAudioSession ownership is shared with the route adapter. The
capture-only compatibility API uses that same implementation through a serialized
ownership controller, rather than opening a second microphone. A conversation
reserves capture during startup and releases capture and routing together. The app does not install an APK or terminate its own process on
iOS. Updates are distributed through the chosen Apple installation channel.

## Requirements

- macOS and Xcode compatible with Expo SDK 56 and React Native 0.85.
- Node 22, Corepack/pnpm 10.34.5, CocoaPods, curl and unzip.
- iOS 16.4 or later, subject to the actual native dependency build.
- An iPhone and a LOOI robot for BLE, speaker/AEC and camera acceptance.
- Your own Apple signing team and an available bundle identifier for device
  distribution. Review `expo.ios.bundleIdentifier` in app.json before signing.
- An Expo account and appropriate Apple membership for EAS device/TestFlight
  distribution when using those services. Do not store signing credentials or
  OpenAI keys in the repository.

Expo Go cannot load the local native modules. Use an Expo development build.

## Local build on a Mac

From the repository root:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run ios:check
corepack pnpm run ios:prepare
corepack pnpm exec expo run:ios --device
```

The preparation script downloads the four official Vosk command models from
`alphacephei.com`, stages them as generated `.bundle` resources, and performs
prebuild. The config plugin also stages the isolated Vosk framework described
below. All four language models are required; preparation fails clearly if
one is missing. Cached models live under `${XDG_CACHE_HOME:-$HOME/.cache}` and
generated resources under the ignored local module `ios/Models` directory.
Do not substitute a different language model merely to make preparation pass.

The Expo 56 native template is explicitly pinned to 56.0.38. During development
the installed Expo package's embedded template advertised Expo 57; using the
pinned SDK 56 template avoids silently switching the native project generation.

The iOS plugin also raises older CocoaPods deployment targets to the app's 16.4
minimum, without lowering a dependency's newer target. This fixes the
ZIPFoundation privacy target's 12.0 setting, which Xcode 27.1 rejects.
`expo-modules-jsi@56.0.12` has a version-bound pnpm patch for a Swift C-function
pointer conversion error: the optional host-object setter uses explicit branches
instead of a ternary conversion. The null-setter branch still reaches C++ as
null. Keep the patch and lockfile together; remove it only after a verified
upstream upgrade passes native compilation and read-only setter behavior.

Vosk and Sherpa bundle different OpenFST versions. Linking both static archives
into the app exposes colliding C++ flag registries and caused a reproducible
pre-main `EXC_BAD_ACCESS` on the physical iPhone. The iOS plugin now builds
`LooiVoskNative.xcframework` from the pinned `react-native-vosk@2.1.7` archives.
It exports the 35 public Vosk C functions and keeps its C++ globals inside the
dynamic framework. Both recognizers remain available. The unused React Native
Vosk microphone module is excluded from iOS autolinking. Generated binaries
live under the ignored local module `ios/Native` directory; do not commit them.
Run `pnpm run ios:vosk-check` on a Mac to verify the device/simulator slices,
public ABI and dynamic-library identity.

Apps built with the current SDK must adopt UIKit scenes on iOS 27. The iOS
plugin adapts the pinned SDK 56 AppDelegate and installs a single-scene manifest.
React Native starts in a scene-owned window. Scene events forward to Expo's
existing delegate subscribers and linking handlers; UIKit continues to supply
the application-state notifications used by React Native. The plugin preserves
the app's foreground-only audio/BLE policy. See Apple's
[scene migration documentation](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)
and the [Expo scene lifecycle notes](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md).

After building the development client, start Metro with:

```bash
corepack pnpm exec expo start --dev-client
```

For a simulator build with local ad-hoc signing:

```bash
corepack pnpm run ios:build-simulator
```

This command prepares the models/project, installs CocoaPods and signs the app
locally for the Simulator. The ad-hoc signature supplies the app identifier
used by iOS Keychain and SecureStore; it needs no Apple development certificate
or provisioning profile. The build verifies the resulting app signature and
saves the Xcode log to `output/ios-simulator-build.log`. It defaults to two
parallel build jobs; override `MY_LOOI_IOS_BUILD_JOBS` if appropriate for your
Mac.

The [native mock-persistence check](research/simulator-mock-persistence-2026-10-26.md)
records the reproduced unsigned-build failure and the successful app-restart
check with local signing.

These native commands are also specified in `.github/workflows/ios.yml`. The
workflow must actually complete before claiming a successful native build.

## EAS

`eas.json` defines development, simulator, preview and production profiles.
Use a suitably current EAS CLI. For example, after authenticating with your own
account and reviewing the project/signing configuration:

```bash
eas build --platform ios --profile development
```

The EAS pre-install hook downloads/stages Vosk resources before native generation.
The resources are generated again on the builder; EAS does not rely on ignored
model files being uploaded from a local checkout. The profiles pin the Expo 56
template as well. Build creation, signing and upload have not been performed by
the Linux cloud task.

## Platform behavior

- Microphone handoff between local wake/command listening and Realtime remains
  serialized. Capture-only and conversation clients cannot acquire or tear down
  each other's capture while a native start is pending.
- Startup, suspend and resume share a lifecycle queue. Returning from a permission
  sheet or background suspension starts a fresh event-loop timing window. A new
  suspend during audio activation or voice restoration prevents the remaining
  camera, movement and BLE startup stages and still releases activated audio.
- Settings voice synchronization uses the same lifecycle queue. Wakeword repair
  checks current conversation ownership and preferences after each wait, so a
  newly started conversation is not reset by delayed recovery work.
- Suspend stops each component independently and records individual failures;
  camera or capture-module errors do not skip BLE/voice teardown or audio-session
  deactivation. Offline STT prewarm also rechecks foreground state after import.
- Foreground BLE recovery retries transient failures after 1, 2 and 4 seconds,
  then stops until another lifecycle/manual recovery. The first link-loss retry
  keeps its existing 700 ms delay. Success resets this retry budget.
- Backgrounding, sleep and replacement/forgotten robot selections invalidate
  pending BLE work. Native radio/scan waits and device connections are cancelled;
  late connection, GATT and notification callbacks cannot revive an old session.
- Settings robot searches preserve the process-wide Bluetooth manager and an
  existing robot connection. Search listeners and timers are released on success,
  failure and background cancellation.
- Connection discovery and Settings searches share radio readiness and scanning
  code. Only the scan owner stops the scanner; concurrent searches are rejected
  until native cleanup finishes. Denied Bluetooth permission and unsupported
  hardware produce an immediate error instead of waiting for a radio timeout.
- The iOS simulator is identified by the native runtime. Automatic wake listening
  follows the same explicit opt-in as the Android emulator; physical devices
  keep the ordinary hands-free default.
- Camera access uses the same Expo permission gate in Settings and explicit photo
  capture, including revocation and a permanent denial.
- AEC must be enabled and the native capture profile must match before Realtime
  becomes ready. Playback interruption reports completed/audible frames rather
  than treating all received audio as played.
- Native microphone input has a half-second processing budget. Delayed callbacks
  are tied to their capture generation. Completed playback ledger entries are
  discarded so a long response does not accumulate an unbounded history.
- A failed audio output cancels/truncates the response and stops the conversation.
  Old socket, camera, memory and capture completions cannot mutate a replacement
  conversation, including while a previous startup is still pending.
- Vosk uses the isolated dynamic C-ABI framework generated from the pinned
  react-native-vosk archives, via a local Expo bridge. Its React Native microphone
  interface is not linked. Autolinking for that dependency is disabled on both
  platforms; Android retains its existing Vosk module.
- The bundled iOS Vosk C ABI does not expose Android's configurable endpoint
  delay APIs. STOP is detected from partial results; endpoint/timing equivalence
  must be measured on the actual device.
- Face detection uses Vision on device. Explicit photos use AVFoundation and are
  normalized in memory. PHPicker reads only images selected by the user, without
  requesting broad photo-library access or creating durable app copies.
- Photo selection/import is serialized. Clearing a selection, backgrounding or
  destroying its module cancels the provider and invalidates late callbacks.
  Camera input changes roll back if configuration fails, and face-analysis frames
  stay unmirrored to preserve the robot's gaze-coordinate convention.
- Files uses picker-granted security-scoped bookmarks. Access is started/stopped
  around each operation and stale bookmarks are refreshed. A moved, revoked or
  unavailable provider folder must be selected again.
- Backup reads enforce their byte limit while reading, rather than trusting
  provider size metadata. Private diagnostic-file transfers are capped at 64 MiB.
- Audio, camera and BLE are suspended in the background. Background audio modes
  are disabled. Android's scheduled process exit is never invoked by iOS app
  lifecycle handling.
- The performance monitor runs on both native platforms. iOS reports resident
  process memory, uptime and thermal state; Android-only heap/PSS/exit metrics
  remain absent rather than being filled with unrelated values.
- The existing OpenAI key entry uses Expo SecureStore, backed by Keychain on iOS.

## Required physical acceptance

1. Install and start with fresh storage. Deny then grant microphone, camera and
   Bluetooth access. Verify clear recovery and locally persisted settings.
2. Scan/select LOOI, reconnect, read GATT notifications, disconnect Bluetooth and
   return. iOS peripheral UUIDs are local identifiers, not Android MAC addresses.
3. Test bidirectional speaker conversation, quiet speech, interruption while LOOI
   speaks, playback gain, wired/Bluetooth routes, calls/Siri and route changes.
   Verify played-duration truncation and microphone recovery.
4. Load each RU/UK/EN command model. Check wake recognition and per-motion STOP,
   including partial results, decoder failure/backlog and unavailable models.
   A failed emergency-recognizer arm must prevent the subsequent drive command.
5. Check local face coordinates in both landscape orientations, explicit front
   and back photos, photo-selection cancellation and image-only access.
6. Export/restore a backup through Files, restart and reuse the selected folder,
   revoke/move the folder and check recovery; export/share a diagnostic archive.
7. Repeatedly background/foreground and lock/unlock. Confirm that no microphone,
   camera, robot motion or reconnect continues while suspended. Run longer
   sessions to check battery, heat, memory and dropped audio.

## Known baseline failures and deferred build prerequisites

Four pre-existing Android source regressions remain: v2.1.137/138 expect still
capture and rear-camera functionality absent from the Android camera module;
v2.1.139/140 expect a missing Android PhotoPickerAccessModule.kt. The iOS modules
do not repair those Android features. The separate Vosk test's missing performance
monitor mock was repaired and its assertions now execute, including an iOS
decoder-failure stop test.

An earlier Linux/cloud pass could not download the Ukrainian model because its
proxy denied `alphacephei.com`; that environment also lacked Xcode and the iOS SDK.
Those were historical environment limits. The subsequent local Mac pass completed
prebuild, native compilation, signing and installation on the physical iPhone.
The app bundle contains the Ukrainian Vosk model; that does not establish readiness
of the separate Sherpa models downloaded during onboarding. The dated iPhone report
tracks the current device setup state.
