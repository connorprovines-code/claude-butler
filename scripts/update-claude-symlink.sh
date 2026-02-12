#!/bin/bash
# Finds the latest Claude Code VS Code extension binary and updates the symlink.
# Runs as ExecStartPre in the systemd service so it's always current on restart/boot.

EXTENSIONS_DIR="$HOME/.vscode/extensions"
SYMLINK_PATH="$HOME/.local/bin/claude"

# Find the newest anthropic.claude-code extension directory
LATEST=$(ls -1d "$EXTENSIONS_DIR"/anthropic.claude-code-*-linux-x64 2>/dev/null | sort -V | tail -1)

if [ -z "$LATEST" ]; then
    echo "No Claude Code extension found in $EXTENSIONS_DIR" >&2
    exit 1
fi

BINARY="$LATEST/resources/native-binary/claude"

if [ ! -x "$BINARY" ]; then
    echo "Claude binary not found or not executable: $BINARY" >&2
    exit 1
fi

mkdir -p "$(dirname "$SYMLINK_PATH")"
ln -sf "$BINARY" "$SYMLINK_PATH"
echo "Symlinked $SYMLINK_PATH -> $BINARY"
