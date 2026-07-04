#!/bin/bash
# Builds a self-contained, shareable macOS app: server code, playbooks, UI,
# production dependencies, and the project's .env (API key!) all inside the
# bundle. Artifacts live in the recipient's ~/Library/Application Support.
# Usage: scripts/package-app.sh [arm64|x64|universal]   (default: arm64)
set -euo pipefail

ARCH="${1:-arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/dist-app/staging"
OUT="$ROOT/dist-app/share"

rm -rf "$STAGE"
mkdir -p "$STAGE/server"

cp "$ROOT/app/main.cjs" "$ROOT/app/package.json" "$STAGE/"
cp -R "$ROOT/src" "$ROOT/playbooks" "$ROOT/public" "$STAGE/server/"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/server/"

if [ -f "$ROOT/.env" ]; then
  cp "$ROOT/.env" "$STAGE/server/.env"
  echo "note: .env (including the API key) is baked into the bundle"
else
  echo "warning: no .env found — recipients will have no API key"
fi

(cd "$STAGE/server" && npm ci --omit=dev --silent)

EL_VER=$(node -p "require('$ROOT/node_modules/electron/package.json').version")
npx electron-packager "$STAGE" "Career Counseling" \
  --platform=darwin --arch="$ARCH" --out="$OUT" --overwrite \
  --electron-version="$EL_VER"

APP="$OUT/Career Counseling-darwin-$ARCH/Career Counseling.app"
codesign --force --deep -s - "$APP" 2>/dev/null || true

ZIP="$ROOT/dist-app/Career-Counseling-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo ""
echo "Built: $APP"
echo "Send:  $ZIP  ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
