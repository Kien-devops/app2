#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing file-service dependencies..."
if command -v npm.cmd >/dev/null 2>&1; then
  npm.cmd ci
else
  npm ci
fi
echo "==> Running file-service tests..."
if command -v npm.cmd >/dev/null 2>&1; then
  npm.cmd test
else
  npm test
fi
