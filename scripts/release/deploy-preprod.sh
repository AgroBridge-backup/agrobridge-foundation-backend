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

tar -czf "$BUILD_ARTIFACT_PATH" dist prisma package.json package-lock.json

echo "Deploying preprod artifact with PREPROD_DEPLOY_COMMAND"
echo "Artifact: $BUILD_ARTIFACT_PATH"
echo "Target:   $PREPROD_BASE_URL"

ARTIFACT_PATH="$BUILD_ARTIFACT_PATH" \
PREPROD_BASE_URL="$PREPROD_BASE_URL" \
GIT_SHA="$SHA" \
bash -lc "$PREPROD_DEPLOY_COMMAND" 2>&1 | tee "$DEPLOY_LOG_PATH"

cat >"$METADATA_PATH" <<JSON
{
  "sha": "$SHA",
  "artifactPath": "$BUILD_ARTIFACT_PATH",
  "deployCommand": "$PREPROD_DEPLOY_COMMAND",
  "preprodBaseUrl": "$PREPROD_BASE_URL"
}
JSON

echo "Preprod deploy step completed."
