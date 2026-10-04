#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo 'ERROR: Node.js is required to run the JavaScript tests.' >&2
  echo 'Install it on Ubuntu/Debian with: sudo apt update && sudo apt install -y nodejs npm' >&2
  echo 'Then verify with: node --version' >&2
  exit 127
fi

if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
  echo "ERROR: Node.js 18 or newer is required; this test suite uses modern JavaScript features." >&2
  echo "Detected version: $(node --version 2>/dev/null || echo unknown)" >&2
  echo "Install a current Node.js LTS release, then rerun: bash tests/run_all.sh" >&2
  exit 2
fi

failed=0
syntax_failed=0
for file in "$ROOT"/js/*.js; do
  node --check "$file" || syntax_failed=1
done
if [ "$syntax_failed" -eq 0 ]; then echo 'PASS: syntax checks for production JavaScript modules'; else failed=1; fi
node "$ROOT/tests/categoryPersistenceAdapter.test.js" || failed=1
node "$ROOT/tests/productionCategoryPersistenceAdapter.test.js" || failed=1
node "$ROOT/tests/categorySyncQueue.test.js" || failed=1
node "$ROOT/tests/productionCategorySyncQueue.test.js" || failed=1
node "$ROOT/tests/sqlSafety.test.js" || failed=1
node "$ROOT/tests/appIntegrationSafety.test.js" || failed=1
python3 "$ROOT/tests/htmlSafety.py" || failed=1
exit "$failed"
