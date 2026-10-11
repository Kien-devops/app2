#!/usr/bin/env bash
set -euo pipefail

echo "==> Running backend-2 tests..."
node --test tests/*.test.js
echo "==> backend-2 tests passed successfully."
