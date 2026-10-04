#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
failed=0
syntax_failed=0
for file in "$ROOT"/candidate-app/js/*.js "$ROOT"/reference-app/js/*.js "$ROOT"/js/*.js; do
  node --check "$file" || syntax_failed=1
done
if [ "$syntax_failed" -eq 0 ]; then echo 'PASS: syntax checks for candidate, reference and adapter JavaScript modules'; else failed=1; fi
node "$ROOT/tests/categoryPersistenceAdapter.test.js" || failed=1
node "$ROOT/tests/categorySyncQueue.test.js" || failed=1
node "$ROOT/tests/sqlSafety.test.js" || failed=1
node "$ROOT/tests/appIntegrationSafety.test.js" || failed=1
python3 "$ROOT/tests/htmlSafety.py" || failed=1
exit "$failed"
