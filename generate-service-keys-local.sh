#!/usr/bin/env bash
# Backward compatibility wrapper — forwards execution to scripts/k8s/generate-service-keys-local.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/scripts/k8s/generate-service-keys-local.sh" "$@"
