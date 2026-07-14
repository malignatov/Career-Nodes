#!/bin/bash
# Assembles the mobile web bundle: existing UI + in-page engine.
#   mobile/www/  ←  public/* + cc-mobile.js (bundled core) + patched index.html
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/bundle-playbooks.ts

rm -rf mobile/www
mkdir -p mobile/www
cp -R public/. mobile/www/

npx esbuild src/mobile-main.ts \
  --bundle --format=iife --platform=browser \
  --outfile=mobile/www/cc-mobile.js \
  --log-level=warning

# The shim script must run before the UI module fetches anything.
python3 - <<'PY'
p = "mobile/www/index.html"
s = open(p).read()
s = s.replace(
  '<script type="module" src="/app.js"></script>',
  '<script src="/cc-mobile.js"></script>\n  <script type="module" src="/app.js"></script>',
)
open(p, "w").write(s)
PY

echo "mobile/www ready ($(du -sh mobile/www | cut -f1 | tr -d ' '))"
