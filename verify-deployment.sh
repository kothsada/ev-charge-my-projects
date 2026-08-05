#!/usr/bin/env bash
# Backward compatibility wrapper — forwards execution to scripts/k8s/verify-deployment.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/scripts/k8s/verify-deployment.sh" "$@"
