# Building and validating the iOS port

My LOOI keeps Expo, React Native and the shared TypeScript application. The iOS
port adds local Expo modules in `modules/*/ios`. Generated root `ios/` files are
not authoritative source and must not be committed.

## Current status

The source adaptation covers the application runtime and its native iOS
implementations. The current work is source-only: builds and physical acceptance
are deferred at the user's request and do not block source changes. TypeScript, native module
discovery, Swift syntax parsing and JavaScript/Hermes export can be checked on
Linux. Those checks do not compile or run the Swift/Objective-C modules. A
successful macOS build and physical iPhone/robot acceptance are still required
before this port can be described as working or release-ready.

The remaining-source pass added shared camera permissions, native iOS simulator
constants, RSS/thermal diagnostics, capture-only compatibility through the shared
PCM engine, and startup/suspend serialization. Logic tests cover competing audio
clients, failed acquisition/teardown, denied permissions, missing runtime modules,
event forwarding, suspended timers and a background transition during startup.
The source regression run passes 49 of 53 scripts; the four Android baseline
failures are listed below. No native build or new JavaScript bundle was run for
this source-only pass.

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

The preparation script downloads the three official Vosk command models from
`alphacephei.com`, stages them as generated `.bundle` resources, and performs
prebuild. All three language models are required; preparation fails clearly if
one is missing. Cached models live under `${XDG_CACHE_HOME:-$HOME/.cache}` and
generated resources under the ignored local module `ios/Models` directory.
Do not substitute a different language model merely to make preparation pass.

The Expo 56 native template is explicitly pinned to 56.0.38. During development
the installed Expo package's embedded template advertised Expo 57; using the
pinned SDK 56 template avoids silently switching the native project generation.

After building the development client, start Metro with:

```bash
corepack pnpm exec expo start --dev-client
```

For an unsigned simulator compilation:

```bash
corepack pnpm run ios:build-simulator
```

This command prepares the models/project, installs CocoaPods and builds without
Apple signing credentials. It keeps the actual build exit status and saves the
Xcode log to `output/ios-simulator-build.log`. It defaults to two parallel build
jobs; override `MY_LOOI_IOS_BUILD_JOBS` if appropriate for your Mac.

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
  sheet or background suspension starts a fresh event-loop timing window.
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
- Vosk uses the pinned react-native-vosk XCFramework via a local Expo bridge.
  Its React Native microphone interface is not used. Android autolinking for
  that dependency is disabled to retain the existing Android Vosk module.
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

During this task the cloud proxy denied `alphacephei.com`, so the Ukrainian model
could not be downloaded and full iOS prebuild could not finish. The domain is
saved as a required network addition in the environment configuration draft.
Review/save that setting and publish through the environment UI, then retry the
model download. No alternate network route or disabled TLS verification is used.
The Linux task has no Xcode/iOS SDK; native compilation and device acceptance
therefore remain separate future checks after model access is restored. They are
not prerequisites for completing the current source rewrite.
