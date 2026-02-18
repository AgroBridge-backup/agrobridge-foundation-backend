#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts/canary}"
DEPLOY_LOG_PATH="${DEPLOY_LOG_PATH:-$ARTIFACT_DIR/deploy-canary.log}"
CANARY_TRAFFIC_PERCENT="${CANARY_TRAFFIC_PERCENT:-5}"
CANARY_RELEASE_ID_FILE="${CANARY_RELEASE_ID_FILE:-$ARTIFACT_DIR/canary-release-id.txt}"

if [[ -z "${CANARY_DEPLOY_COMMAND:-}" ]]; then
  echo "ERROR: CANARY_DEPLOY_COMMAND is required." >&2
  echo "Expected a command that deploys artifact to canary and writes release id (optional)." >&2
  exit 1
fi

if [[ -z "${CANARY_BASE_URL:-}" ]]; then
  echo "ERROR: CANARY_BASE_URL is required." >&2
  exit 1
fi

if [[ ! -d "dist" ]]; then
  echo "ERROR: dist/ not found. Run npm run build before deploy-canary.sh." >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
BUILD_ARTIFACT_PATH="$ARTIFACT_DIR/backend-dist-canary-${SHA}.tar.gz"
METADATA_PATH="$ARTIFACT_DIR/deploy-canary-metadata.json"
ARTIFACT_SENSITIVITY="${ARTIFACT_SENSITIVITY:-restricted-internal}"

tar -czf "$BUILD_ARTIFACT_PATH" dist prisma package.json package-lock.json

echo "Deploying canary release"
echo "Artifact: $BUILD_ARTIFACT_PATH"
echo "Target: $CANARY_BASE_URL"
echo "Traffic slice: ${CANARY_TRAFFIC_PERCENT}%"

ARTIFACT_PATH="$BUILD_ARTIFACT_PATH" \
CANARY_BASE_URL="$CANARY_BASE_URL" \
CANARY_TRAFFIC_PERCENT="$CANARY_TRAFFIC_PERCENT" \
CANARY_RELEASE_ID_FILE="$CANARY_RELEASE_ID_FILE" \
GIT_SHA="$SHA" \
bash -lc "$CANARY_DEPLOY_COMMAND" 2>&1 | tee "$DEPLOY_LOG_PATH"

CANARY_RELEASE_ID=""
if [[ -f "$CANARY_RELEASE_ID_FILE" ]]; then
  CANARY_RELEASE_ID="$(tr -d '[:space:]' <"$CANARY_RELEASE_ID_FILE")"
fi

SHA="$SHA" \
ARTIFACT_PATH="$BUILD_ARTIFACT_PATH" \
CANARY_BASE_URL="$CANARY_BASE_URL" \
CANARY_TRAFFIC_PERCENT="$CANARY_TRAFFIC_PERCENT" \
CANARY_RELEASE_ID="$CANARY_RELEASE_ID" \
ARTIFACT_SENSITIVITY="$ARTIFACT_SENSITIVITY" \
METADATA_PATH="$METADATA_PATH" \
node <<'NODE'
const fs = require('fs');

const payload = {
  sha: process.env.SHA,
  artifactPath: process.env.ARTIFACT_PATH,
  canaryBaseUrl: process.env.CANARY_BASE_URL,
  canaryTrafficPercent: process.env.CANARY_TRAFFIC_PERCENT,
  canaryReleaseId: process.env.CANARY_RELEASE_ID || null,
  sensitivity: process.env.ARTIFACT_SENSITIVITY,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(process.env.METADATA_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
NODE

echo "Canary deploy step completed."
