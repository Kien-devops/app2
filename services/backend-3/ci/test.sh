#!/usr/bin/env bash
set -euo pipefail

echo "==> Running backend-3 tests..."
node --test tests/*.test.js
echo "==> backend-3 tests passed successfully."
