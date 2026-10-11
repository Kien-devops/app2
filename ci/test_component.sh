#!/usr/bin/env bash
set -euo pipefail

component_path="${1:?component path required}"
cd "$component_path"

if [[ -f ./ci/test.sh ]]; then
  bash ./ci/test.sh
  exit 0
fi

if [[ -f package-lock.json ]]; then
  npm ci
  npm run lint --if-present
  npm test --if-present
  npm run build --if-present
elif [[ -f package.json ]]; then
  npm install
  npm run lint --if-present
  npm test --if-present
  npm run build --if-present
elif [[ -f requirements.txt ]]; then
  python -m pip install -r requirements.txt
  if [[ -d tests ]]; then python -m pytest -q; fi
elif [[ -f pyproject.toml ]]; then
  python -m pip install .
  if [[ -d tests ]]; then python -m pytest -q; fi
elif [[ -f go.mod ]]; then
  go test ./...
elif [[ -f pom.xml ]]; then
  mvn -B test
elif [[ -f build.gradle || -f build.gradle.kts ]]; then
  ./gradlew test
else
  echo "No supported project manifest found in $component_path; skipping tests for skeleton stage."
fi
