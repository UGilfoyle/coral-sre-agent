#!/usr/bin/env bash
set -euo pipefail

# Render's Node image lacks GLIBC 2.39 required by the Coral CLI binary.
# Production demo runs through Neon Postgres; skip Coral CLI install here.
export SKIP_CORAL_CLI=true

echo "Installing dependencies..."
npm install -g pnpm
pnpm install --frozen-lockfile

echo "Building frontend..."
pnpm run build

echo "Generating Coral source specs (no CLI registration)..."
node scripts/setup.js

echo "Render build complete."
