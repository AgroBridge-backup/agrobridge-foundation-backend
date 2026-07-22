#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts/canary}"
ROLLBACK_LOG_PATH="${ROLLBACK_LOG_PATH:-$ARTIFACT_DIR/rollback-canary.log}"
CANARY_RELEASE_ID_FILE="${CANARY_RELEASE_ID_FILE:-$ARTIFACT_DIR/canary-release-id.txt}"

if [[ -z "${CANARY_ROLLBACK_COMMAND:-}" ]]; then
  echo "ERROR: CANARY_ROLLBACK_COMMAND is required." >&2
  echo "Expected a command that rolls back the active canary release." >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

CANARY_RELEASE_ID="${CANARY_RELEASE_ID:-}"
if [[ -z "$CANARY_RELEASE_ID" && -f "$CANARY_RELEASE_ID_FILE" ]]; then
  CANARY_RELEASE_ID="$(tr -d '[:space:]' <"$CANARY_RELEASE_ID_FILE")"
fi

echo "Rolling back canary release"
if [[ -n "$CANARY_RELEASE_ID" ]]; then
  echo "Release id: $CANARY_RELEASE_ID"
else
  echo "Release id not provided; rollback command must resolve current canary release."
fi

CANARY_RELEASE_ID="$CANARY_RELEASE_ID" \
CANARY_BASE_URL="${CANARY_BASE_URL:-}" \
bash -lc "$CANARY_ROLLBACK_COMMAND" 2>&1 | tee "$ROLLBACK_LOG_PATH"

echo "Canary rollback completed."
