# Third-party notices

My LOOI uses third-party open-source software and model assets. Their original licenses remain applicable.

## Upstream project

Portions of My LOOI originated from the MIT-licensed `GrinZero/super-looi` project. The historical MIT notice that accompanied the upstream source is preserved in `licenses/UPSTREAM_EXPO_MIT_NOTICE.txt`.

## Vosk command models

Android and iOS builds download and bundle selected Vosk command models from the official Vosk model catalog. The selected models used by the build script are listed by Vosk as Apache License 2.0 models. A copy of Apache License 2.0 is included in `licenses/APACHE-2.0.txt`.

German command recognition uses `vosk-model-small-de-0.15` (Copyright © 2020 Alpha Cephei Inc.). Its original `COPYING` and `README` files stay with the staged model assets.

Source: https://alphacephei.com/vosk/models

## Silero VAD

The repository includes a Silero VAD ONNX model under `assets/models/sherpa-onnx/vad/`. Silero VAD is distributed under the MIT License; its notice is preserved in `licenses/SILERO-VAD-MIT.txt`.

Source: https://github.com/snakers4/silero-vad

## sherpa-onnx

The project uses sherpa-onnx-based runtime components. The sherpa-onnx source project is licensed under Apache License 2.0; a copy is included in `licenses/APACHE-2.0.txt`.

Source: https://github.com/k2-fsa/sherpa-onnx

Some optional speech/speaker model files are downloaded from upstream model releases rather than committed to this repository. Model weights can have license terms distinct from the inference runtime; verify the license of any additional model before redistributing it.

## OpenAI

OpenAI model weights are not distributed with My LOOI. Realtime models and voices are accessed through the OpenAI API using the user's own API key and are subject to OpenAI's applicable terms and pricing.

## Apple platform components

The iOS command bridge links the Vosk XCFramework distributed by the MIT-licensed
react-native-vosk package (https://github.com/riderodd/react-native-vosk).
The Vosk runtime retains Alpha Cephei's Apache-2.0 license. The application uses
its existing microphone pipeline rather than react-native-vosk's recording API.

Diagnostic ZIP export uses ZIPFoundation 0.9.20 under the MIT License
(https://github.com/weichsel/ZIPFoundation). Expo development builds also use the
MIT-licensed expo-dev-client package. Preserve their upstream notices in binary
distribution and include them in the final Apple application license inventory.

## Character props

The cup-soda, coffee, cookie and book-open SVG icons are from Lucide
(https://lucide.dev), under the ISC License. The pinned original assets and full
upstream license are in `assets/character-props/`; `SOURCE.md` records provenance.

## Situation picture library

The 200 scene props in `assets/character-scenes/props/` use original Lucide
(ISC, including Feather MIT notices) and Tabler Icons (MIT) SVG geometry.
`SOURCE.json` pins each upstream URL, commit and original file hash.
Complete notices are retained as `LICENSE-LUCIDE` and `LICENSE-TABLER`.
The corresponding full face pictures and PNG previews are composed locally
using LOOI's existing geometric face rig.

## Native glass face

The face renderer uses react-native-svg under the MIT License
(https://github.com/software-mansion/react-native-svg). Its original notice is
preserved in `licenses/REACT-NATIVE-SVG-MIT.txt`. Glass contours and gradients are
authored locally; the supplied visual references are not bundled as image assets.

## JavaScript and Android dependencies

The application also includes packages resolved through pnpm, Expo/React Native autolinking, and Gradle. Each dependency remains subject to its own license. A final public APK should receive a binary/license inventory audit before release.
