#!/bin/bash
# Build the mobile app and run it on a physical iPhone.
#
# One-time prerequisites (account holder, in Xcode):
#   - Xcode → Settings → Accounts: signed in with the developer Apple ID
#   - an "Apple Development" certificate (Manage Certificates… → +)
#   - Developer Mode enabled on the phone
#
#   scripts/run-ios-device.sh [device-identifier]
# TEAM_ID is auto-detected from the signing identity when possible;
# override with TEAM_ID=XXXXXXXXXX.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEV="${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ {print $(NF-2)}' | head -1)}"
[ -n "$DEV" ] || { echo "no physical iPhone found — plug it in and trust this Mac"; exit 1; }

TEAM="${TEAM_ID:-$(security find-identity -v -p codesigning \
  | grep -oE 'Apple Development.*\(([A-Z0-9]{10})\)' | grep -oE '[A-Z0-9]{10}' | head -1)}"
[ -n "$TEAM" ] || { echo "no Apple Development identity — create one in Xcode → Settings → Accounts → Manage Certificates"; exit 1; }

bash scripts/build-mobile.sh
npx cap sync ios

cd ios/App
xcodebuild -project App.xcodeproj -target App -sdk iphoneos -configuration Debug \
  SYMROOT="$PWD/build-d" EXCLUDED_SOURCE_FILE_NAMES="Assets.xcassets" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build | tail -2

xcrun devicectl device install app --device "$DEV" build-d/Debug-iphoneos/App.app
xcrun devicectl device process launch --device "$DEV" app.careercounseling.local
echo "running on device $DEV (team $TEAM)"
