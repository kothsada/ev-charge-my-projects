#!/usr/bin/env bash
# ============================================================
# generate-service-keys.sh
#
# Generates RS256 key pairs and saves them as .pem / .pub files
# inside a  keys/  directory (gitignored).
#
# Usage:
#   chmod +x generate-service-keys.sh
#   ./generate-service-keys.sh
#
# Compatible with bash 3.2+ (macOS default) and Linux.
# ============================================================

set -euo pipefail

upper() { echo "$1" | tr '[:lower:]' '[:upper:]'; }
b64()   { base64 < "$1" | tr -d '\n'; }

KEYS_DIR="$(cd "$(dirname "$0")" && pwd)/keys"
mkdir -p "$KEYS_DIR"

SERVICES="admin mobile ocpp"

echo "Generating RS256 key pairs (2048-bit RSA)..."
echo "Output directory: $KEYS_DIR"
echo ""

for SVC in $SERVICES; do
  openssl genrsa -out "$KEYS_DIR/${SVC}.pem" 2048 2>/dev/null
  openssl rsa -in "$KEYS_DIR/${SVC}.pem" -pubout -out "$KEYS_DIR/${SVC}.pub" 2>/dev/null
  chmod 600 "$KEYS_DIR/${SVC}.pem"  # private keys: owner read-only
  chmod 644 "$KEYS_DIR/${SVC}.pub"

  echo "  $(upper $SVC): $KEYS_DIR/${SVC}.pem  |  $KEYS_DIR/${SVC}.pub"
done

echo ""
echo "================================================================"
echo "OPTION A — File path env vars (recommended for local/Docker)   "
echo "================================================================"
echo ""

echo "# panda-ev-csms-system-admin/.env"
echo "SERVICE_NAME=admin-api"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$KEYS_DIR/admin.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$KEYS_DIR"
echo "TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp"
echo "JWT_PRIVATE_KEY_PATH=$KEYS_DIR/admin.pem"
echo "JWT_PUBLIC_KEY_PATH=$KEYS_DIR/admin.pub"
echo ""

echo "# panda-ev-client-mobile/.env"
echo "SERVICE_NAME=mobile-api"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$KEYS_DIR/mobile.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$KEYS_DIR"
echo "TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp"
echo "JWT_PRIVATE_KEY_PATH=$KEYS_DIR/mobile.pem"
echo "JWT_PUBLIC_KEY_PATH=$KEYS_DIR/mobile.pub"
echo ""

echo "# panda-ev-ocpp/.env"
echo "SERVICE_NAME=ocpp-csms"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$KEYS_DIR/ocpp.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$KEYS_DIR"
echo "TRUSTED_SERVICE_ISSUERS=mobile-api:mobile"
echo ""

echo "================================================================"
echo "OPTION B — Base64 env vars (recommended for K8s Secrets)       "
echo "================================================================"
echo ""

for SVC in $SERVICES; do
  SVC_UPPER=$(upper "$SVC")
  echo "${SVC_UPPER}_PRIVATE_KEY=$(b64 "$KEYS_DIR/${SVC}.pem")"
  echo "${SVC_UPPER}_PUBLIC_KEY=$(b64 "$KEYS_DIR/${SVC}.pub")"
  echo ""
done

ADMIN_PUB=$(b64 "$KEYS_DIR/admin.pub")
MOBILE_PUB=$(b64 "$KEYS_DIR/mobile.pub")
OCPP_PUB=$(b64 "$KEYS_DIR/ocpp.pub")

echo "# panda-ev-csms-system-admin:"
echo "SERVICE_NAME=admin-api"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$KEYS_DIR/admin.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUB}\"}]"
echo "JWT_PRIVATE_KEY=$(b64 "$KEYS_DIR/admin.pem")"
echo "JWT_PUBLIC_KEY=${ADMIN_PUB}"
echo ""

echo "# panda-ev-client-mobile:"
echo "SERVICE_NAME=mobile-api"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$KEYS_DIR/mobile.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUB}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUB}\"}]"
echo "JWT_PRIVATE_KEY=$(b64 "$KEYS_DIR/mobile.pem")"
echo "JWT_PUBLIC_KEY=${MOBILE_PUB}"
echo ""

echo "# panda-ev-ocpp:"
echo "SERVICE_NAME=ocpp-csms"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$KEYS_DIR/ocpp.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"}]"
echo ""

echo "================================================================"
echo "IMPORTANT"
echo "  - Add  keys/  to .gitignore  (private keys must never be committed)"
echo "  - For Docker: mount keys/ as a read-only volume"
echo "    e.g.  -v \$(pwd)/keys:/app/keys:ro"
echo "  - For K8s: use Option B (base64) stored in a Secret"
echo "================================================================"
