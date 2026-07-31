#!/bin/bash
# Builds a self-contained, shareable app: server code, playbooks, UI,
# production dependencies, and the project's .env (API key!) all inside the
# bundle. Artifacts live in the recipient's per-user app-data directory.
# Usage: scripts/package-app.sh [darwin|win32|linux] [arm64|x64|universal]
#   default: darwin arm64
#   Windows: scripts/package-app.sh win32 x64
#   Ubuntu:  scripts/package-app.sh linux x64
set -euo pipefail

PLATFORM="${1:-darwin}"
ARCH="${2:-arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Staging lives OUTSIDE the project tree: electron-packager's metadata
# inference walks parent directories and would inherit version/author from the
# root package.json — which drags in rcedit and a Wine dependency for win32.
STAGE="$(mktemp -d)/app"
OUT="$ROOT/dist-app/share"

mkdir -p "$STAGE/server"

cp "$ROOT/app/main.cjs" "$ROOT/app/preload.cjs" "$ROOT/app/package.json" "$ROOT/app/icon.png" "$STAGE/"
cp -R "$ROOT/src" "$ROOT/playbooks" "$ROOT/public" "$STAGE/server/"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/server/"

if [ -f "$ROOT/.env" ]; then
  # Bake ONLY what the app needs at runtime. Never the management key (it can
  # mint keys against the account) and not the unused Anthropic key.
  grep -E "^(LLM_PROVIDER|LLM_API_KEY|LLM_ZDR|LLM_ALLOW_PROVIDERS|LLM_IGNORE_PROVIDERS|LLM_ORDER_PROVIDERS|LLM_SORT|LLM_RETRY_MS|LLM_SMALL_|LLM_LARGE_|OPENAI_API_KEY)" "$ROOT/.env" > "$STAGE/server/.env" || true
  echo "note: baked into the bundle: $(cut -d= -f1 "$STAGE/server/.env" | tr '\n' ' ')"
else
  echo "warning: no .env found — recipients will have no API key"
fi

# Production deps are pure JS (sdk, js-yaml, ws) — platform-independent.
(cd "$STAGE/server" && npm ci --omit=dev --silent)

EL_VER=$(node -p "require('$ROOT/node_modules/electron/package.json').version")
BUILT="$OUT/Career Nodes-$PLATFORM-$ARCH"
ZIP="$ROOT/dist-app/Career-Nodes-$PLATFORM-$ARCH.zip"
rm -f "$ZIP"

if [ "$PLATFORM" = "darwin" ]; then
  npx electron-packager "$STAGE" "Career Nodes" \
    --platform="$PLATFORM" --arch="$ARCH" --out="$OUT" --overwrite \
    --electron-version="$EL_VER" --icon="$ROOT/app/icon.icns"
  APP="$BUILT/Career Nodes.app"
  codesign --force --deep -s - "$APP" 2>/dev/null || true
  ditto -c -k --keepParent "$APP" "$ZIP"
else
  # Windows/Linux: assemble manually — official Electron zip + our app in
  # resources/app + renamed binary. That is all electron-packager does here,
  # minus exe metadata stamping (which would require Wine on macOS).
  EZIP=$(node -e "require('@electron/get').downloadArtifact({version:'$EL_VER',platform:'$PLATFORM',arch:'$ARCH',artifactName:'electron'}).then((p)=>console.log(p))")
  rm -rf "$BUILT"
  mkdir -p "$BUILT"
  ditto -x -k "$EZIP" "$BUILT"
  cp -R "$STAGE" "$BUILT/resources/app"
  if [ "$PLATFORM" = "win32" ]; then
    mv "$BUILT/electron.exe" "$BUILT/Career Nodes.exe"
    ditto -c -k --keepParent "$BUILT" "$ZIP"
    # Friendlier hand-off than a zip: a per-user Setup.exe with shortcuts and
    # an uninstaller. Native makensis first; the Homebrew arm64 bottle crashes
    # with bad_alloc on this OS (even on a 4-line script), so fall back to the
    # Debian makensis in docker (colima must be running).
    SETUP="$ROOT/dist-app/Career-Nodes-Setup-x64.exe"
    rm -f "$SETUP"
    NSI_OK=0
    if command -v makensis >/dev/null 2>&1; then
      makensis -V2 -DSRCDIR="$BUILT" -DOUTFILE="$SETUP" "$ROOT/scripts/installer.nsi" && NSI_OK=1 || true
    fi
    if [ "$NSI_OK" = 0 ] && command -v docker >/dev/null 2>&1; then
      echo "native makensis unavailable or crashed — building the installer in docker…"
      docker run --rm -v "$ROOT:/work" -w /work debian:stable-slim bash -c \
        "apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq nsis >/dev/null 2>&1 && makensis -V2 -DSRCDIR='/work/${BUILT#"$ROOT"/}' -DOUTFILE='/work/dist-app/Career-Nodes-Setup-x64.exe' scripts/installer.nsi" \
        && NSI_OK=1 || true
    fi
    if [ "$NSI_OK" = 1 ] && [ -f "$SETUP" ]; then
      echo "Setup: $SETUP  ($(du -h "$SETUP" | cut -f1 | tr -d ' '))"
    else
      echo "note: no working makensis (native or docker) — skipped Career-Nodes-Setup-x64.exe"
    fi
  else
    mv "$BUILT/electron" "$BUILT/career-nodes"
    chmod +x "$BUILT/career-nodes" "$BUILT/chrome-sandbox" 2>/dev/null || true
    # tar.gz for Linux — reliably preserves the executable bit.
    ZIP="$ROOT/dist-app/Career-Nodes-$PLATFORM-$ARCH.tar.gz"
    rm -f "$ZIP"
    tar -czf "$ZIP" -C "$OUT" "Career Nodes-$PLATFORM-$ARCH"
  fi
fi

echo ""
echo "Built: $BUILT"
echo "Send:  $ZIP  ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
