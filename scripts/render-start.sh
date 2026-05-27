#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

if command -v coral >/dev/null 2>&1; then
  pnpm run setup || echo "Warning: Coral setup failed — continuing with Neon fallback"
fi

exec pnpm start
