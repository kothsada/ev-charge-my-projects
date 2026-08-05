#!/usr/bin/env bash
# Backward compatibility wrapper — forwards execution to scripts/testing/test-charging-flow.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/scripts/testing/test-charging-flow.sh" "$@"
