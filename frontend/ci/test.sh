#!/usr/bin/env bash
set -euo pipefail

echo "==> Running frontend tests..."
node --test tests/*.test.js
echo "==> Frontend tests passed successfully."
