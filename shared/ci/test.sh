#!/usr/bin/env bash
set -euo pipefail

echo "==> Running shared component tests..."
node --test tests/*.test.js
echo "==> Shared component tests completed successfully."
