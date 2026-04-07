#!/usr/bin/env bash
# ============================================================
# generate-service-keys-local.sh
#
# Generates RS256 key pairs (2048-bit) and stores each service's
# private + public key inside THAT SERVICE'S OWN  keys/  directory:
#
#   panda-ev-csms-system-admin/keys/admin.pem        admin.pub
#   panda-ev-client-mobile/keys/mobile.pem           mobile.pub
#   panda-ev-ocpp/keys/ocpp.pem                      ocpp.pub
#   panda-ev-notification/keys/notification.pem      notification.pub
#   panda-ev-gateway-services/keys/gateway.pem       gateway.pub
#
# After generation the public keys are cross-copied so that
# TRUSTED_SERVICE_PUBLIC_KEYS_DIR (Option A) works without manual steps:
#
#   admin/keys/        also contains: mobile.pub  ocpp.pub  notification.pub  gateway.pub
#   mobile/keys/       also contains: admin.pub   ocpp.pub  notification.pub  gateway.pub
#   ocpp/keys/         also contains: admin.pub   mobile.pub
#   notification/keys/ also contains: admin.pub   mobile.pub
#   gateway/keys/      also contains: admin.pub   mobile.pub
#
# Existing key files are NOT overwritten — delete a service's
# keys/ directory to force regeneration.
#
# Usage (run from the monorepo root):
#   chmod +x generate-service-keys-local.sh
#   ./generate-service-keys-local.sh
#
# Compatible with bash 3.2+ (macOS default) and Linux.
# ============================================================

set -euo pipefail

upper() { echo "$1" | tr '[:lower:]' '[:upper:]'; }
b64()   { base64 < "$1" | tr -d '\n'; }

# Resolve the root to the directory containing this script
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Returns the service directory for a given short name
service_dir() {
  case "$1" in
    admin)        echo "$ROOT/panda-ev-csms-system-admin" ;;
    mobile)       echo "$ROOT/panda-ev-client-mobile" ;;
    ocpp)         echo "$ROOT/panda-ev-ocpp" ;;
    notification) echo "$ROOT/panda-ev-notification" ;;
    gateway)      echo "$ROOT/panda-ev-gateway-services" ;;
  esac
}

SERVICES="admin mobile ocpp notification gateway"

# ── Step 1: Generate keys (skip if already present) ──────────────────────────

echo "Generating RS256 key pairs (per-service keys/ directories)..."
echo "Monorepo root: $ROOT"
echo ""

all_ok=true
for SVC in $SERVICES; do
  SVC_DIR="$(service_dir "$SVC")"
  KEYS_DIR="$SVC_DIR/keys"

  if [ ! -d "$SVC_DIR" ]; then
    echo "  WARNING: service directory not found — $SVC_DIR"
    all_ok=false
    continue
  fi

  # Create keys/ if it does not exist
  if [ ! -d "$KEYS_DIR" ]; then
    mkdir -p "$KEYS_DIR"
    echo "  $(upper "$SVC"): created $KEYS_DIR"
  fi

  PEM="$KEYS_DIR/${SVC}.pem"
  PUB="$KEYS_DIR/${SVC}.pub"

  if [ -f "$PEM" ] && [ -f "$PUB" ]; then
    echo "  $(upper "$SVC"): keys already exist — skipping (delete $KEYS_DIR to regenerate)"
  else
    openssl genrsa -out "$PEM" 2048 2>/dev/null
    openssl rsa -in "$PEM" -pubout -out "$PUB" 2>/dev/null
    chmod 600 "$PEM"
    chmod 644 "$PUB"
    echo "  $(upper "$SVC"): generated"
    echo "            private → $PEM"
    echo "            public  → $PUB"
  fi
done

echo ""

if [ "$all_ok" = false ]; then
  echo "ERROR: one or more service directories are missing. Aborting."
  exit 1
fi

# ── Step 2: Cross-copy public keys so Option A dir trust works ────────────────
#
#   Each service's keys/ dir must also contain the public keys of the services
#   it trusts. This avoids manual copy steps when using TRUSTED_SERVICE_PUBLIC_KEYS_DIR.

echo "Cross-copying public keys for Option A (TRUSTED_SERVICE_PUBLIC_KEYS_DIR)..."

ADMIN_KEYS="$(service_dir "admin")/keys"
MOBILE_KEYS="$(service_dir "mobile")/keys"
OCPP_KEYS="$(service_dir "ocpp")/keys"
NOTIF_KEYS="$(service_dir "notification")/keys"
GATEWAY_KEYS="$(service_dir "gateway")/keys"

# admin/keys/ needs: mobile.pub  ocpp.pub  notification.pub  gateway.pub
cp -n "$MOBILE_KEYS/mobile.pub" "$ADMIN_KEYS/mobile.pub" 2>/dev/null \
  && echo "  Copied mobile.pub       → admin/keys/" \
  || echo "  admin/keys/mobile.pub already present — skipping"

cp -n "$OCPP_KEYS/ocpp.pub" "$ADMIN_KEYS/ocpp.pub" 2>/dev/null \
  && echo "  Copied ocpp.pub         → admin/keys/" \
  || echo "  admin/keys/ocpp.pub already present — skipping"

cp -n "$NOTIF_KEYS/notification.pub" "$ADMIN_KEYS/notification.pub" 2>/dev/null \
  && echo "  Copied notification.pub → admin/keys/" \
  || echo "  admin/keys/notification.pub already present — skipping"

cp -n "$GATEWAY_KEYS/gateway.pub" "$ADMIN_KEYS/gateway.pub" 2>/dev/null \
  && echo "  Copied gateway.pub      → admin/keys/" \
  || echo "  admin/keys/gateway.pub already present — skipping"

# mobile/keys/ needs: admin.pub  ocpp.pub  notification.pub  gateway.pub
cp -n "$ADMIN_KEYS/admin.pub" "$MOBILE_KEYS/admin.pub" 2>/dev/null \
  && echo "  Copied admin.pub        → mobile/keys/" \
  || echo "  mobile/keys/admin.pub already present — skipping"

cp -n "$OCPP_KEYS/ocpp.pub" "$MOBILE_KEYS/ocpp.pub" 2>/dev/null \
  && echo "  Copied ocpp.pub         → mobile/keys/" \
  || echo "  mobile/keys/ocpp.pub already present — skipping"

cp -n "$NOTIF_KEYS/notification.pub" "$MOBILE_KEYS/notification.pub" 2>/dev/null \
  && echo "  Copied notification.pub → mobile/keys/" \
  || echo "  mobile/keys/notification.pub already present — skipping"

cp -n "$GATEWAY_KEYS/gateway.pub" "$MOBILE_KEYS/gateway.pub" 2>/dev/null \
  && echo "  Copied gateway.pub      → mobile/keys/" \
  || echo "  mobile/keys/gateway.pub already present — skipping"

# ocpp/keys/ needs: admin.pub  mobile.pub
cp -n "$ADMIN_KEYS/admin.pub" "$OCPP_KEYS/admin.pub" 2>/dev/null \
  && echo "  Copied admin.pub        → ocpp/keys/" \
  || echo "  ocpp/keys/admin.pub already present — skipping"

cp -n "$MOBILE_KEYS/mobile.pub" "$OCPP_KEYS/mobile.pub" 2>/dev/null \
  && echo "  Copied mobile.pub       → ocpp/keys/" \
  || echo "  ocpp/keys/mobile.pub already present — skipping"

# notification/keys/ needs: admin.pub  mobile.pub  ocpp.pub
# (notification consumes PANDA_EV_QUEUE published by ocpp-csms — must verify x-service-token)
cp -n "$ADMIN_KEYS/admin.pub" "$NOTIF_KEYS/admin.pub" 2>/dev/null \
  && echo "  Copied admin.pub        → notification/keys/" \
  || echo "  notification/keys/admin.pub already present — skipping"

cp -n "$MOBILE_KEYS/mobile.pub" "$NOTIF_KEYS/mobile.pub" 2>/dev/null \
  && echo "  Copied mobile.pub       → notification/keys/" \
  || echo "  notification/keys/mobile.pub already present — skipping"

cp -n "$OCPP_KEYS/ocpp.pub" "$NOTIF_KEYS/ocpp.pub" 2>/dev/null \
  && echo "  Copied ocpp.pub         → notification/keys/" \
  || echo "  notification/keys/ocpp.pub already present — skipping"

# gateway/keys/ needs: admin.pub  mobile.pub
# (gateway may verify inbound service calls from admin/mobile in the future)
cp -n "$ADMIN_KEYS/admin.pub" "$GATEWAY_KEYS/admin.pub" 2>/dev/null \
  && echo "  Copied admin.pub        → gateway/keys/" \
  || echo "  gateway/keys/admin.pub already present — skipping"

cp -n "$MOBILE_KEYS/mobile.pub" "$GATEWAY_KEYS/mobile.pub" 2>/dev/null \
  && echo "  Copied mobile.pub       → gateway/keys/" \
  || echo "  gateway/keys/mobile.pub already present — skipping"

echo ""

# ── Collect base64 values for Option B output ────────────────────────────────

ADMIN_PUB=$(b64   "$ADMIN_KEYS/admin.pub")
MOBILE_PUB=$(b64  "$MOBILE_KEYS/mobile.pub")
OCPP_PUB=$(b64    "$OCPP_KEYS/ocpp.pub")
NOTIF_PUB=$(b64   "$NOTIF_KEYS/notification.pub")
GATEWAY_PUB=$(b64 "$GATEWAY_KEYS/gateway.pub")

# ── Step 3: Print .env blocks ─────────────────────────────────────────────────

echo "================================================================"
echo "OPTION A — File path env vars (local dev / Docker volume mount) "
echo "================================================================"
echo ""

echo "# panda-ev-csms-system-admin/.env"
echo "SERVICE_NAME=admin-api"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$ADMIN_KEYS/admin.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$ADMIN_KEYS"
echo "TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp,notification-service:notification,gateway-api:gateway"
echo "JWT_PRIVATE_KEY_PATH=$ADMIN_KEYS/admin.pem"
echo "JWT_PUBLIC_KEY_PATH=$ADMIN_KEYS/admin.pub"
echo ""

echo "# panda-ev-client-mobile/.env"
echo "SERVICE_NAME=mobile-api"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$MOBILE_KEYS/mobile.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$MOBILE_KEYS"
echo "TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp,notification-service:notification,gateway-api:gateway"
echo "JWT_PRIVATE_KEY_PATH=$MOBILE_KEYS/mobile.pem"
echo "JWT_PUBLIC_KEY_PATH=$MOBILE_KEYS/mobile.pub"
echo ""

echo "# panda-ev-ocpp/.env"
echo "SERVICE_NAME=ocpp-csms"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$OCPP_KEYS/ocpp.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$OCPP_KEYS"
echo "TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,admin-api:admin"
echo ""

echo "# panda-ev-notification/.env"
echo "SERVICE_NAME=notification-service"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$NOTIF_KEYS/notification.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$NOTIF_KEYS"
echo "TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,admin-api:admin,ocpp-csms:ocpp"
echo ""

echo "# panda-ev-gateway-services/.env"
echo "SERVICE_NAME=gateway-api"
echo "SERVICE_JWT_PRIVATE_KEY_PATH=$GATEWAY_KEYS/gateway.pem"
echo "TRUSTED_SERVICE_PUBLIC_KEYS_DIR=$GATEWAY_KEYS"
echo "TRUSTED_SERVICE_ISSUERS=admin-api:admin,mobile-api:mobile"
echo "JWT_PUBLIC_KEY_PATH=$MOBILE_KEYS/mobile.pub"
echo ""

echo "================================================================"
echo "OPTION B — Base64 env vars (K8s Secrets / CI)                  "
echo "================================================================"
echo ""

echo "# panda-ev-csms-system-admin/.env"
echo "SERVICE_NAME=admin-api"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$ADMIN_KEYS/admin.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUB}\"},{\"iss\":\"notification-service\",\"key\":\"${NOTIF_PUB}\"},{\"iss\":\"gateway-api\",\"key\":\"${GATEWAY_PUB}\"}]"
echo "JWT_PRIVATE_KEY=$(b64 "$ADMIN_KEYS/admin.pem")"
echo "JWT_PUBLIC_KEY=${ADMIN_PUB}"
echo ""

echo "# panda-ev-client-mobile/.env"
echo "SERVICE_NAME=mobile-api"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$MOBILE_KEYS/mobile.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUB}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUB}\"},{\"iss\":\"notification-service\",\"key\":\"${NOTIF_PUB}\"},{\"iss\":\"gateway-api\",\"key\":\"${GATEWAY_PUB}\"}]"
echo "JWT_PRIVATE_KEY=$(b64 "$MOBILE_KEYS/mobile.pem")"
echo "JWT_PUBLIC_KEY=${MOBILE_PUB}"
echo ""

echo "# panda-ev-ocpp/.env"
echo "SERVICE_NAME=ocpp-csms"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$OCPP_KEYS/ocpp.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"},{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUB}\"}]"
echo ""

echo "# panda-ev-notification/.env"
echo "SERVICE_NAME=notification-service"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$NOTIF_KEYS/notification.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"},{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUB}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUB}\"}]"
echo ""

echo "# panda-ev-gateway-services/.env"
echo "SERVICE_NAME=gateway-api"
echo "SERVICE_JWT_PRIVATE_KEY=$(b64 "$GATEWAY_KEYS/gateway.pem")"
echo "TRUSTED_SERVICE_PUBLIC_KEYS=[{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUB}\"},{\"iss\":\"mobile-api\",\"key\":\"${MOBILE_PUB}\"}]"
echo "JWT_PUBLIC_KEY=${MOBILE_PUB}"
echo ""

echo "================================================================"
echo "IMPORTANT"
echo "  - keys/ is gitignored in every service — never committed"
echo "  - For Docker: mount each service's keys/ as read-only:"
echo "      -v \$(pwd)/keys:/app/keys:ro"
echo "  - For K8s: use Option B values in kubectl create secret generic"
echo "  - Run this script again after key rotation; existing files are"
echo "    left untouched unless you delete a service's keys/ directory"
echo "================================================================"
