#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="panda-ev-prod"
SECRET_NAME="panda-rabbitmq-prod-secrets"

echo "Deleting existing secret (if any)..."
kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" --ignore-not-found

echo "Creating secret: $SECRET_NAME in namespace: $NAMESPACE ..."
kubectl create secret generic "$SECRET_NAME" \
  --from-literal=rabbitmq-password='PVndAi2026iR3PP1' \
  --from-literal=rabbitmq-erlang-cookie='S3cr3tR3PP1tC00k1E' \
  --from-literal=RABBITMQ_URL='amqp://user:PVndAi2026iR3PP1@panda-rabbitmq.panda-ev-prod.svc.cluster.local:5672' \
  -n "$NAMESPACE"

echo "Done. Secret '$SECRET_NAME' created in namespace '$NAMESPACE'."
