#!/usr/bin/env bash
set -euo pipefail

file="${1:?changed-files file required}"

frontend=false
backend1=false
backend2=false
backend3=false
file_service=false
all=false

while IFS= read -r line || [[ -n "$line" ]]; do
  # Trim carriage return and leading/trailing whitespace
  path=$(echo "$line" | tr -d '\r' | xargs)
  [[ -z "$path" ]] && continue

  case "$path" in
    shared/*)
      all=true
      ;;
    frontend/*)
      [[ "$path" != "frontend/.gitkeep" ]] && frontend=true
      ;;
    services/backend-1/*)
      [[ "$path" != "services/backend-1/.gitkeep" ]] && backend1=true
      ;;
    services/backend-2/*)
      [[ "$path" != "services/backend-2/.gitkeep" ]] && backend2=true
      ;;
    services/backend-3/*)
      [[ "$path" != "services/backend-3/.gitkeep" ]] && backend3=true
      ;;
    services/file-service/*)
      file_service=true
      ;;
  esac
done < "$file"

if [[ "$all" == true ]]; then
  frontend=true
  backend1=true
  backend2=true
  backend3=true
  file_service=true
fi

items=()
[[ "$frontend" == true ]] && items+=("\"frontend\"")
[[ "$backend1" == true ]] && items+=("\"backend-1\"")
[[ "$backend2" == true ]] && items+=("\"backend-2\"")
[[ "$backend3" == true ]] && items+=("\"backend-3\"")
[[ "$file_service" == true ]] && items+=("\"file-service\"")

if [[ ${#items[@]} -eq 0 ]]; then
  echo "[]"
else
  IFS=,
  echo "[${items[*]}]"
fi
