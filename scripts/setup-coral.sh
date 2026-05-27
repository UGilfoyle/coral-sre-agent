#!/bin/bash
set -e

echo "=== Initializing Coral Sources ==="

if ! command -v coral &> /dev/null; then
    echo "Coral is not installed. Please install it first using: brew install withcoral/tap/coral"
    exit 1
fi

# Resolve portable paths from templates into .coral-generated/ and register with CLI
pnpm run setup

echo "=== All Coral Sources Added Successfully! ==="
echo "Verifying sources..."
coral source discover
