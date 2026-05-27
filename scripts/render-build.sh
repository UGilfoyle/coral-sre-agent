#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

echo "Installing Coral CLI..."
curl -fsSL https://withcoral.com/install.sh | sh
export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

echo "Installing dependencies..."
npm install -g pnpm
pnpm install --frozen-lockfile

echo "Building frontend..."
pnpm run build

echo "Registering Coral sources..."
pnpm run setup

echo "Render build complete."
