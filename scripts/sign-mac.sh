#!/bin/bash
# Sign, notarize, and staple the packaged macOS app so recipients can open it
# without Gatekeeper quarantine friction.
#
# One-time prerequisites (account holder):
#   - a "Developer ID Application" certificate in the keychain
#     (Xcode → Settings → Accounts → Manage Certificates… → +)
#   - notarization credentials stored once:
#       xcrun notarytool store-credentials cc-notary \
#         --apple-id <apple-id-email> --team-id <TEAMID> --password <app-specific-password>
#
#   scripts/sign-mac.sh            # sign + notarize + staple + re-zip
#   SKIP_NOTARY=1 scripts/sign-mac.sh   # sign only (recipients still get a
#                                        one-time right-click-Open prompt)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist-app/share/Career Nodes-darwin-arm64/Career Nodes.app"
ZIP="$ROOT/dist-app/Career-Nodes-darwin-arm64.zip"
PROFILE="${NOTARY_PROFILE:-cc-notary}"

[ -d "$APP" ] || { echo "no packaged app — run: npm run app:dist"; exit 1; }

IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning \
  | grep -m1 "Developer ID Application" | sed 's/.*"\(.*\)"/\1/')}"
[ -n "$IDENTITY" ] || { echo "no Developer ID Application certificate — create one in Xcode → Settings → Accounts → Manage Certificates"; exit 1; }
echo "signing as: $IDENTITY"

# Electron needs JIT + unsigned executable memory under the hardened runtime.
ENT="$(mktemp -d)/entitlements.plist"
cat > "$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
</dict></plist>
PLIST

sign() { codesign --force --options runtime --timestamp --entitlements "$ENT" --sign "$IDENTITY" "$1"; }

# Innermost first: frameworks & dylibs, then helper apps, then the main app.
find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework" | while read -r fw; do
  find "$fw" -name "*.dylib" -o -name "chrome_crashpad_handler" -o -name "ShipIt" 2>/dev/null | while read -r bin; do sign "$bin"; done
  sign "$fw"
done
find "$APP/Contents/Frameworks" -maxdepth 1 -name "*Helper*.app" | while read -r helper; do
  sign "$helper"
done
sign "$APP"

codesign --verify --deep --strict "$APP" && echo "signature verifies"

if [ "${SKIP_NOTARY:-}" != "1" ]; then
  echo "notarizing (profile: $PROFILE)…"
  NZIP="$(mktemp -d)/notarize.zip"
  ditto -c -k --keepParent "$APP" "$NZIP"
  xcrun notarytool submit "$NZIP" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$APP"
  echo "stapled — offline Gatekeeper approval included"
fi

rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Send: $ZIP ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
