#!/usr/bin/env bash
set -euo pipefail

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

passed=0
failed=0

assert_scenario() {
  local name="$1"
  local files="$2"
  local expected="$3"

  local test_file="$TMP_DIR/test_${passed}_${failed}.txt"
  printf "%b\n" "$files" > "$test_file"

  local actual
  actual=$(bash ci/detect_changes.sh "$test_file")

  if [[ "$actual" == "$expected" ]]; then
    echo "  [PASS] $name => $actual"
    passed=$((passed + 1))
  else
    echo "  [FAIL] $name: expected '$expected', got '$actual'"
    failed=$((failed + 1))
  fi
}

echo "==> Running change detection unit tests..."

assert_scenario "Backend-2 change" "services/backend-2/src/app.js" '["backend-2"]'
assert_scenario "Frontend change" "frontend/src/app.js" '["frontend"]'
assert_scenario "Backend-1 change" "services/backend-1/src/app.js" '["backend-1"]'
assert_scenario "Backend-3 change" "services/backend-3/src/app.js" '["backend-3"]'
assert_scenario "Shared change triggers all 4" "shared/src/health.js" '["frontend","backend-1","backend-2","backend-3"]'
assert_scenario "Docs change skips all" "docs/README.md" '[]'
assert_scenario "Root README change skips all" "README.md" '[]'
assert_scenario "Docs + README change skips all" "docs/labs/01-local-development.md\nREADME.md" '[]'
assert_scenario "Multiple services (frontend + backend-3)" "frontend/src/app.js\nservices/backend-3/src/app.js" '["frontend","backend-3"]'

echo "==> Change detection test results: $passed passed, $failed failed."

if [[ $failed -gt 0 ]]; then
  exit 1
fi
