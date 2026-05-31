#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${1:-panda-ev-prod}"

RABBITMQ_USER="user"
RABBITMQ_PASS="PVndAi2026iR3PP1"
RABBITMQ_HOST="panda-rabbitmq.${NAMESPACE}.svc.cluster.local"

# dev ໃຊ້ secret ແຍກ ເພື່ອບໍ່ conflict ກັບ prod Helm-managed secret
if [ "$NAMESPACE" = "panda-ev-dev" ]; then
  SECRET_NAME="panda-rabbitmq-dev-secrets"
else
  SECRET_NAME="panda-rabbitmq-prod-secrets"
fi

echo "Deleting existing secret (if any)..."
kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" --ignore-not-found

echo "Creating secret: $SECRET_NAME in namespace: $NAMESPACE ..."
kubectl create secret generic "$SECRET_NAME" \
  --from-literal=rabbitmq-password="${RABBITMQ_PASS}" \
  --from-literal=rabbitmq-erlang-cookie='S3cr3tR3PP1tC00k1E' \
  --from-literal=RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:5672" \
  -n "$NAMESPACE"

echo "Done. Secret '$SECRET_NAME' created in namespace '$NAMESPACE'."
