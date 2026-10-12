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
assert_scenario "File-service change" "services/file-service/src/app.js" '["file-service"]'
assert_scenario "Shared change triggers all 5" "shared/src/health.js" '["frontend","backend-1","backend-2","backend-3","file-service"]'
assert_scenario "Docs change skips all" "docs/README.md" '[]'
assert_scenario "Root README change skips all" "README.md" '[]'
assert_scenario "Docs + README change skips all" "docs/labs/01-local-development.md\nREADME.md" '[]'
assert_scenario "Multiple services (frontend + backend-3)" "frontend/src/app.js\nservices/backend-3/src/app.js" '["frontend","backend-3"]'
assert_scenario "Multiple services (frontend + file-service)" "frontend/src/app.js\nservices/file-service/src/storage.js" '["frontend","file-service"]'

filter_gitops_matrix() {
  COMPONENTS_JSON="$1" node -e "const c=JSON.parse(process.env.COMPONENTS_JSON).filter(x=>x!=='file-service'); process.stdout.write(JSON.stringify(c))"
}

if [[ "$(filter_gitops_matrix '["file-service"]')" == '[]' ]]; then
  echo '  [PASS] File-service-only skips EKS GitOps'
  passed=$((passed + 1))
else
  echo '  [FAIL] File-service-only must skip EKS GitOps'
  failed=$((failed + 1))
fi

if [[ "$(filter_gitops_matrix '["frontend","file-service"]')" == '["frontend"]' ]]; then
  echo '  [PASS] Mixed matrix removes file-service from EKS GitOps'
  passed=$((passed + 1))
else
  echo '  [FAIL] Mixed matrix must remove file-service from EKS GitOps'
  failed=$((failed + 1))
fi

echo "==> Change detection test results: $passed passed, $failed failed."

if [[ $failed -gt 0 ]]; then
  exit 1
fi
