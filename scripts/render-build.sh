#!/usr/bin/env bash
set -euo pipefail

export CORAL_VERSION="${CORAL_VERSION:-v0.4.0}"
export CORAL_INSTALL_DIR="${CORAL_INSTALL_DIR:-${HOME}/.local/bin}"
export PATH="${CORAL_INSTALL_DIR}:/usr/local/bin:${PATH}"

echo "Installing Coral CLI (${CORAL_VERSION})..."
mkdir -p "${CORAL_INSTALL_DIR}"
curl -fsSL https://withcoral.com/install.sh | sh

export PATH="${CORAL_INSTALL_DIR}:/usr/local/bin:${PATH}"

if ! command -v coral >/dev/null 2>&1; then
  echo "ERROR: Coral CLI not found after install. PATH=${PATH}"
  ls -la "${CORAL_INSTALL_DIR}" || true
  exit 1
fi

coral --version
echo "export PATH=${CORAL_INSTALL_DIR}:/usr/local/bin:\${PATH}" > .render-path

echo "Installing dependencies..."
npm install -g pnpm
pnpm install --frozen-lockfile

echo "Building frontend..."
pnpm run build

echo "Registering Coral sources..."
pnpm run setup

echo "Render build complete."
