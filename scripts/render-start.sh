#!/usr/bin/env bash
set -euo pipefail

if [ -f .render-path ]; then
  # shellcheck disable=SC1091
  source .render-path
fi

export CORAL_VERSION="${CORAL_VERSION:-v0.4.0}"
export CORAL_INSTALL_DIR="${CORAL_INSTALL_DIR:-${HOME}/.local/bin}"
export PATH="${CORAL_INSTALL_DIR}:/usr/local/bin:${PATH}"

if ! command -v coral >/dev/null 2>&1; then
  echo "Coral CLI missing at runtime — reinstalling..."
  mkdir -p "${CORAL_INSTALL_DIR}"
  curl -fsSL https://withcoral.com/install.sh | sh
  export PATH="${CORAL_INSTALL_DIR}:/usr/local/bin:${PATH}"
fi

if command -v coral >/dev/null 2>&1; then
  pnpm run setup || echo "Warning: Coral setup failed — continuing with Neon fallback"
else
  echo "Warning: Coral CLI unavailable — demo uses Neon Postgres only"
fi

exec pnpm start
