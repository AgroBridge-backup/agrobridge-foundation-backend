#!/usr/bin/env bash
# =============================================================================
# AgroBridge Foundation Backend - Render Startup Script
#
# Runs Prisma migrations then starts the production server.
# Used as the Docker CMD on Render.
# =============================================================================

set -euo pipefail

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

echo "==> Starting server..."
exec node dist/src/server.js
