#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${ARTIFACT_DIR:-artifacts/preprod}"
DEPLOY_LOG_PATH="${DEPLOY_LOG_PATH:-$ARTIFACT_DIR/deploy-preprod.log}"

if [[ -z "${PREPROD_DEPLOY_COMMAND:-}" ]]; then
  echo "ERROR: PREPROD_DEPLOY_COMMAND is required." >&2
  echo "Expected a command that deploys the built artifact to preprod." >&2
  exit 1
fi

if [[ -z "${PREPROD_BASE_URL:-}" ]]; then
  echo "ERROR: PREPROD_BASE_URL is required." >&2
  exit 1
fi

if [[ ! -d "dist" ]]; then
  echo "ERROR: dist/ not found. Run npm run build before deploy-preprod.sh." >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
BUILD_ARTIFACT_PATH="$ARTIFACT_DIR/backend-dist-${SHA}.tar.gz"
METADATA_PATH="$ARTIFACT_DIR/deploy-preprod-metadata.json"
COMMAND_HASH="$(printf '%s' "$PREPROD_DEPLOY_COMMAND" | shasum -a 256 | awk '{print $1}')"
COMMAND_IDENTIFIER="${PREPROD_DEPLOY_COMMAND_ID:-sha256:${COMMAND_HASH}}"
ARTIFACT_SENSITIVITY="${ARTIFACT_SENSITIVITY:-restricted-internal}"

tar -czf "$BUILD_ARTIFACT_PATH" dist prisma package.json package-lock.json

echo "Deploying preprod artifact with PREPROD_DEPLOY_COMMAND"
echo "Artifact: $BUILD_ARTIFACT_PATH"
echo "Target:   $PREPROD_BASE_URL"

ARTIFACT_PATH="$BUILD_ARTIFACT_PATH" \
PREPROD_BASE_URL="$PREPROD_BASE_URL" \
GIT_SHA="$SHA" \
bash -lc "$PREPROD_DEPLOY_COMMAND" 2>&1 | tee "$DEPLOY_LOG_PATH"

SHA="$SHA" \
ARTIFACT_PATH="$BUILD_ARTIFACT_PATH" \
COMMAND_HASH="$COMMAND_HASH" \
COMMAND_IDENTIFIER="$COMMAND_IDENTIFIER" \
PREPROD_BASE_URL="$PREPROD_BASE_URL" \
ARTIFACT_SENSITIVITY="$ARTIFACT_SENSITIVITY" \
METADATA_PATH="$METADATA_PATH" \
node <<'NODE'
const fs = require('fs');

const payload = {
  sha: process.env.SHA,
  artifactPath: process.env.ARTIFACT_PATH,
  commandHash: process.env.COMMAND_HASH,
  commandIdentifier: process.env.COMMAND_IDENTIFIER,
  preprodBaseUrl: process.env.PREPROD_BASE_URL,
  sensitivity: process.env.ARTIFACT_SENSITIVITY,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(process.env.METADATA_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
NODE

echo "Preprod deploy step completed."
