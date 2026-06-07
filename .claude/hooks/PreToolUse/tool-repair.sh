#!/usr/bin/env bash
# Claude Code PreToolUse hook for tool-call repair hints.
# Adds repair hints as additional context when a tool call matches
# known failure patterns for the current model.
#
# This hook runs BEFORE every tool call. It does NOT modify the call —
# it only adds a hint to the context so the model learns from the mistake.

# Find the tool-repair package directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOLITH_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TOOL_REPAIR_DIR="$MONOLITH_DIR/packages/tool-repair"

if [ ! -f "$TOOL_REPAIR_DIR/bin/tool-repair.ts" ]; then
  exit 0
fi

# Read stdin (the tool call JSON)
INPUT=$(cat)

# Skip empty input
if [ -z "$INPUT" ]; then
  exit 0
fi

# Pass through the tool-repair engine
echo "$INPUT" | npx tsx "$TOOL_REPAIR_DIR/bin/tool-repair.ts" process 2>/dev/null || true
