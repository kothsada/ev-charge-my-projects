#!/usr/bin/env bash
# Backward compatibility wrapper — forwards execution to scripts/gcp/create-prod-slaves.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/scripts/gcp/create-prod-slaves.sh" "$@"
