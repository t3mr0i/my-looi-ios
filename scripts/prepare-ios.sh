#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
corepack pnpm install --frozen-lockfile
bash scripts/download-vosk-command-models.sh
node scripts/stage-ios-vosk-models.cjs
# Retain native build state; CocoaPods runs on macOS as part of expo run:ios.
corepack pnpm exec expo prebuild --platform ios --no-install --template expo-template-bare-minimum@56.0.38
