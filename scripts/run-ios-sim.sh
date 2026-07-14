#!/bin/bash
# Build the mobile bundle and run it on the iOS simulator.
#
# Uses a target-based xcodebuild instead of `cap run`: on beta macOS/Xcode
# combos the scheme destination matcher and ibtool/actool are broken, so we
# skip storyboards (project is storyboard-free), exclude the asset catalog,
# and install with simctl directly.
#   scripts/run-ios-sim.sh [simulator-udid]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

UDID="${1:-$(xcrun simctl list devices available | grep -m1 -oE "iPhone [0-9]+ \(([A-F0-9-]+)\)" | grep -oE "[A-F0-9-]{36}")}"
[ -n "$UDID" ] || { echo "no available iPhone simulator found"; exit 1; }

bash scripts/build-mobile.sh
npx cap sync ios

cd ios/App
xcodebuild -project App.xcodeproj -target App -sdk iphonesimulator -configuration Debug \
  SYMROOT="$PWD/build-t" EXCLUDED_SOURCE_FILE_NAMES="Assets.xcassets" build | tail -1

xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" build-t/Debug-iphonesimulator/App.app
xcrun simctl launch "$UDID" app.careercounseling.local
open -a Simulator
echo "running on simulator $UDID"
