#!/usr/bin/env bash
set -euo pipefail

echo "==> Running backend-1 tests..."
node --test tests/*.test.js
echo "==> backend-1 tests passed successfully."
