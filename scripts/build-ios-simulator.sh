#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != Darwin ]]; then
  echo "A native iOS build requires macOS with Xcode. This machine cannot run xcodebuild." >&2
  exit 1
fi
for tool in corepack xcodebuild pod curl unzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing prerequisite: $tool. See docs/ios.md." >&2
    exit 1
  fi
done
xcodebuild -version
corepack pnpm run ios:prepare
pod install --project-directory=ios
mkdir -p output
xcodebuild -workspace ios/MyLOOI.xcworkspace -scheme MyLOOI \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -jobs "${MY_LOOI_IOS_BUILD_JOBS:-2}" \
  -derivedDataPath output/ios-derived \
  CODE_SIGNING_ALLOWED=YES 'CODE_SIGN_LOCAL_EXECUTION_IDENTITY=Ad Hoc' build \
  2>&1 | tee output/ios-simulator-build.log

simulator_app='output/ios-derived/Build/Products/Debug-iphonesimulator/MyLOOI.app'
codesign --verify --deep --strict "$simulator_app"
