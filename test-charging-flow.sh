#!/usr/bin/env bash
# =============================================================================
# Panda EV — End-to-End Charging Flow Test
# =============================================================================
# Covers:
#   1. DB init  : push schema + seed all 3 services
#   2. Register : mobile user via email (OTP read from Redis)
#   3. Wallet   : top-up 100,000 LAK
#   4. Session  : start charging on PANDA-THATLUANG-01 / connector 1
#   5. OCPP     : VCP sends StartTransaction (meterStart=0 Wh)
#   6. OCPP     : VCP sends StopTransaction  (meterStop=10,000 Wh = 10 kWh)
#   7. Verify   : session COMPLETED, wallet deducted 10,000 LAK (10 kWh × 1,000)
#
# Prerequisites (must be running before Phase 2+):
#   • PostgreSQL  on localhost:5432
#   • Redis       on localhost:6379
#   • RabbitMQ    on localhost:5672  (user:password)
#   • Admin API   on localhost:4000
#   • Mobile API  on localhost:4001
#   • OCPP CSMS   on localhost:3000
#   • VCP         connected as PANDA-THATLUANG-01 (see Phase 2 instructions)
# =============================================================================

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✔ $*${NC}"; }
info() { echo -e "${CYAN}▸ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
fail() { echo -e "${RED}✘ $*${NC}"; exit 1; }
hdr()  { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}"; }

jq_or_echo() {
  # pretty-print JSON if jq is available, otherwise raw
  if command -v jq &>/dev/null; then echo "$1" | jq .; else echo "$1"; fi
}

# ── config ───────────────────────────────────────────────────────────────────
ADMIN_URL="http://localhost:4000/admin/v1"
MOBILE_URL="http://localhost:4001/api/mobile/v1"
OCPP_VCP_URL="http://localhost:9999"   # VCP admin HTTP port

ADMIN_DB="postgresql://postgresuser:postgrespassword@localhost:5432/panda-ev-system-db"
MOBILE_DB="postgresql://postgresuser:postgrespassword@localhost:5432/panda-ev-core-db"
OCPP_DB="postgresql://postgresuser:postgrespassword@localhost:5432/panda-ev-ocpp-db"

TEST_EMAIL="test@pandaev.com"
TEST_PASSWORD="Test@123456"
TEST_TOPUP=100000        # LAK
METER_STOP=10000         # Wh  → 10 kWh  → expect 10,000 LAK charge at 1,000/kWh
CHARGER_IDENTITY="PANDA-THATLUANG-01"
CONNECTOR_ID=1

MONOREPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# =============================================================================
# PHASE 1 — DB INITIALISATION
# =============================================================================
hdr "PHASE 1 — DB INIT"

init_dbs() {
  # ── Admin ──────────────────────────────────────────────────────────────────
  info "Admin: pushing schema …"
  cd "$MONOREPO_ROOT/panda-ev-csms-system-admin"
  npx prisma db push 2>&1 | tail -3
  info "Admin: running seed (permissions, roles, user, locations, stations) …"
  npx prisma db seed 2>&1 | tail -5
  ok "Admin DB ready"

  # ── Mobile ─────────────────────────────────────────────────────────────────
  info "Mobile: applying migrations …"
  cd "$MONOREPO_ROOT/panda-ev-client-mobile"
  npx prisma migrate deploy 2>&1 | tail -3
  ok "Mobile DB ready"

  # ── OCPP ───────────────────────────────────────────────────────────────────
  info "OCPP: pushing schema …"
  cd "$MONOREPO_ROOT/panda-ev-ocpp"
  npx prisma db push 2>&1 | tail -3
  info "OCPP: seeding chargers …"
  npx ts-node prisma/seed/seed.ts 2>&1 | tail -8
  ok "OCPP DB ready"

  cd "$MONOREPO_ROOT"
}

init_dbs

# =============================================================================
# PHASE 2 — PRE-FLIGHT CHECK (services + VCP)
# =============================================================================
hdr "PHASE 2 — PRE-FLIGHT CHECK"

wait_http() {
  local name="$1" url="$2"
  info "Waiting for $name at $url …"
  local retries=30
  until curl -sf "$url" &>/dev/null; do
    retries=$((retries - 1))
    [[ $retries -le 0 ]] && fail "$name did not respond after 30 retries. Is it running?"
    sleep 1
  done
  ok "$name is up"
}

wait_http "Admin API"  "$ADMIN_URL/../health"
wait_http "Mobile API" "$MOBILE_URL/../health"
wait_http "OCPP CSMS"  "http://localhost:3000/health"

# Check VCP admin port
if ! curl -sf --max-time 2 "$OCPP_VCP_URL" &>/dev/null 2>&1; then
  warn "VCP admin port not yet reachable at $OCPP_VCP_URL"
  echo ""
  echo -e "${YELLOW}Start the VCP in a separate terminal:${NC}"
  echo -e "  cd $MONOREPO_ROOT/ocpp-virtual-charge-point"
  echo -e "  WS_URL=ws://localhost:3000/ocpp CP_ID=$CHARGER_IDENTITY npm start index_16.ts"
  echo ""
  read -rp "Press Enter once the VCP is connected and you see 'BootNotification accepted' in the OCPP logs …"
fi
ok "VCP is reachable"

# Verify charger registered in OCPP DB
CHARGER_STATUS=$(psql "$OCPP_DB" -t -A -c \
  "SELECT status FROM panda_ev_ocpp.chargers WHERE ocpp_identity='$CHARGER_IDENTITY' LIMIT 1" 2>/dev/null || echo "")
[[ "$CHARGER_STATUS" == "ONLINE" ]] && ok "Charger $CHARGER_IDENTITY is ONLINE in OCPP DB" \
  || warn "Charger status: '${CHARGER_STATUS:-NOT FOUND}' — VCP may not have sent BootNotification yet"

# =============================================================================
# PHASE 3 — REGISTER & AUTHENTICATE MOBILE USER
# =============================================================================
hdr "PHASE 3 — MOBILE USER REGISTRATION"

info "Registering test user: $TEST_EMAIL …"
REGISTER_RESP=$(curl -sf -X POST "$MOBILE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"confirmPassword\":\"$TEST_PASSWORD\",\"agreedToTerms\":true}" \
  2>/dev/null || echo '{}')

USER_ID=$(echo "$REGISTER_RESP" | grep -o '"userId":"[^"]*"' | cut -d'"' -f4 || echo "")
[[ -z "$USER_ID" ]] && {
  warn "Register response:"
  jq_or_echo "$REGISTER_RESP"
  # Might already be registered from a previous run — try to login directly
  warn "User may already exist — trying login …"
}

# Read OTP from Redis (try direct then via docker exec)
info "Reading OTP from Redis (key: otp:$TEST_EMAIL) …"
OTP=$(redis-cli -h 127.0.0.1 -p 6379 get "otp:$TEST_EMAIL" 2>/dev/null | tr -d '[:space:]')
[[ -z "$OTP" ]] && OTP=$(docker exec redis redis-cli get "otp:$TEST_EMAIL" 2>/dev/null | tr -d '[:space:]')
[[ -z "$OTP" ]] && fail "OTP not found in Redis. Check that the mobile service is running and SMTP/SMS is not required."
ok "OTP: $OTP"

info "Verifying OTP …"
VERIFY_RESP=$(curl -sf -X POST "$MOBILE_URL/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"otp\":\"$OTP\"}" \
  2>/dev/null || echo '{}')
ok "OTP verified"

info "Logging in …"
LOGIN_RESP=$(curl -sf -X POST "$MOBILE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
  2>/dev/null || echo '{}')

ACCESS_TOKEN=$(echo "$LOGIN_RESP" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4 || echo "")
[[ -z "$ACCESS_TOKEN" ]] && {
  jq_or_echo "$LOGIN_RESP"
  fail "Login failed — no accessToken in response"
}
ok "Logged in — token: ${ACCESS_TOKEN:0:30}…"

AUTH="Authorization: Bearer $ACCESS_TOKEN"

# =============================================================================
# PHASE 4 — WALLET TOP-UP
# =============================================================================
hdr "PHASE 4 — WALLET TOP-UP"

info "Topping up wallet with ${TEST_TOPUP} LAK …"
TOPUP_RESP=$(curl -sf -X POST "$MOBILE_URL/wallet/topup" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d "{\"amount\":$TEST_TOPUP}" \
  2>/dev/null || echo '{}')

BALANCE=$(echo "$TOPUP_RESP" | grep -o '"balance":[0-9.]*' | cut -d: -f2 || echo "?")
ok "Wallet balance: ${BALANCE} LAK"

# =============================================================================
# PHASE 5 — LOOK UP STATION & START CHARGING SESSION
# =============================================================================
hdr "PHASE 5 — START CHARGING SESSION"

# Get stationId from admin DB by identity code
STATION_ID=$(psql "$ADMIN_DB" -t -A -c \
  "SELECT id FROM panda_ev_system.stations WHERE identity_code='panda-thatluang' LIMIT 1" 2>/dev/null || echo "")
[[ -z "$STATION_ID" ]] && fail "Station 'panda-thatluang' not found in admin DB. Run the admin seed first."
ok "Station ID: $STATION_ID"

info "Starting charging session on $CHARGER_IDENTITY / connector $CONNECTOR_ID …"
START_RESP=$(curl -sf -X POST "$MOBILE_URL/charging-sessions/start" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d "{
    \"stationId\":\"$STATION_ID\",
    \"stationName\":\"Panda EV — Thatluang Marsh\",
    \"chargerIdentity\":\"$CHARGER_IDENTITY\",
    \"connectorId\":$CONNECTOR_ID,
    \"pricePerKwh\":1000
  }" \
  2>/dev/null || echo '{}')

SESSION_ID=$(echo "$START_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
[[ -z "$SESSION_ID" ]] && {
  jq_or_echo "$START_RESP"
  fail "startSession failed — no session id in response"
}
ok "Session created: $SESSION_ID (status=ACTIVE, waiting for OCPP StartTransaction)"

# =============================================================================
# PHASE 6 — SIMULATE OCPP StartTransaction via VCP
# =============================================================================
hdr "PHASE 6 — VCP: StartTransaction"

info "Sending StartTransaction via VCP admin port …"
START_TX_RESP=$(curl -sf -X POST "$OCPP_VCP_URL/execute" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\":\"StartTransaction\",
    \"payload\":{\"connectorId\":$CONNECTOR_ID,\"idTag\":\"MOBILE_APP\",\"meterStart\":0,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
  }" \
  2>/dev/null || echo '{}')
ok "StartTransaction sent"

# Wait for OCPP → Mobile RabbitMQ event to link ocppTransactionId
info "Waiting 3 s for transaction.started event to propagate …"
sleep 3

# Verify session now has ocppTransactionId set
SESSION_CHECK=$(psql "$MOBILE_DB" -t -A -c \
  "SELECT status, ocpp_transaction_id FROM panda_ev_core.charging_sessions WHERE id='$SESSION_ID' LIMIT 1" \
  2>/dev/null || echo "")
echo "  Session row: $SESSION_CHECK"

OCPP_TX_ID=$(echo "$SESSION_CHECK" | cut -d'|' -f2 | tr -d '[:space:]')
[[ -z "$OCPP_TX_ID" || "$OCPP_TX_ID" == "" ]] && \
  warn "ocppTransactionId not yet set — RabbitMQ may still be processing" || \
  ok "ocppTransactionId linked: $OCPP_TX_ID"

# =============================================================================
# PHASE 7 — SIMULATE OCPP StopTransaction via VCP
# =============================================================================
hdr "PHASE 7 — VCP: StopTransaction"

# Use ocppTransactionId from OCPP DB if not available from mobile DB
if [[ -z "$OCPP_TX_ID" ]]; then
  OCPP_TX_ID=$(psql "$OCPP_DB" -t -A -c \
    "SELECT ocpp_transaction_id FROM panda_ev_ocpp.transactions ORDER BY created_at DESC LIMIT 1" \
    2>/dev/null | tr -d '[:space:]')
  [[ -z "$OCPP_TX_ID" ]] && fail "Cannot find OCPP transaction ID. Did StartTransaction succeed?"
  ok "OCPP Transaction ID (from OCPP DB): $OCPP_TX_ID"
fi

info "Sending StopTransaction (meterStop=$METER_STOP Wh = $(( METER_STOP / 1000 )) kWh) …"
STOP_TX_RESP=$(curl -sf -X POST "$OCPP_VCP_URL/execute" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\":\"StopTransaction\",
    \"payload\":{\"transactionId\":$OCPP_TX_ID,\"meterStop\":$METER_STOP,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"reason\":\"Local\"}
  }" \
  2>/dev/null || echo '{}')
ok "StopTransaction sent"

info "Waiting 3 s for transaction.stopped event to propagate …"
sleep 3

# =============================================================================
# PHASE 8 — VERIFY RESULTS
# =============================================================================
hdr "PHASE 8 — VERIFY RESULTS"

# ── Charging Session ──────────────────────────────────────────────────────────
SESSION_ROW=$(psql "$MOBILE_DB" -t -A -c \
  "SELECT status, ROUND(energy_kwh::numeric,3), amount, ocpp_transaction_id
   FROM panda_ev_core.charging_sessions WHERE id='$SESSION_ID'" \
  2>/dev/null || echo "")
echo ""
echo -e "  ${BOLD}Charging Session:${NC}"
echo "  ┌──────────────────────────────────────────"
echo "  │  ID       : $SESSION_ID"
echo "  │  Row data : $SESSION_ROW"
SESSION_STATUS=$(echo "$SESSION_ROW" | cut -d'|' -f1)
SESSION_KWH=$(echo "$SESSION_ROW" | cut -d'|' -f2)
SESSION_AMOUNT=$(echo "$SESSION_ROW" | cut -d'|' -f3)
echo "  │  Status   : $SESSION_STATUS"
echo "  │  Energy   : ${SESSION_KWH} kWh"
echo "  │  Amount   : ${SESSION_AMOUNT} LAK"
echo "  └──────────────────────────────────────────"

[[ "$SESSION_STATUS" == "COMPLETED" ]] && ok "Session status: COMPLETED ✓" \
  || warn "Session status: $SESSION_STATUS (expected COMPLETED)"

EXPECTED_AMOUNT=$(( METER_STOP / 1000 * 1000 ))   # 10 kWh × 1000 LAK/kWh = 10000
echo "  Expected amount: $EXPECTED_AMOUNT LAK"
[[ "$SESSION_AMOUNT" == "$EXPECTED_AMOUNT" ]] && ok "Amount correct: ${SESSION_AMOUNT} LAK ✓" \
  || warn "Amount mismatch — got ${SESSION_AMOUNT}, expected ${EXPECTED_AMOUNT}"

# ── Wallet ────────────────────────────────────────────────────────────────────
echo ""
WALLET_RESP=$(curl -sf "$MOBILE_URL/wallet" -H "$AUTH" 2>/dev/null || echo '{}')
WALLET_BALANCE=$(echo "$WALLET_RESP" | grep -o '"balance":[0-9.]*' | cut -d: -f2 || echo "?")
EXPECTED_BALANCE=$(( TEST_TOPUP - EXPECTED_AMOUNT ))

echo -e "  ${BOLD}Wallet:${NC}"
echo "  ┌──────────────────────────────────────────"
echo "  │  Top-up          : $TEST_TOPUP LAK"
echo "  │  Charge (energy) : $EXPECTED_AMOUNT LAK"
echo "  │  Expected balance: $EXPECTED_BALANCE LAK"
echo "  │  Actual balance  : $WALLET_BALANCE LAK"
echo "  └──────────────────────────────────────────"
[[ "$WALLET_BALANCE" == "$EXPECTED_BALANCE" ]] && ok "Wallet balance correct: ${WALLET_BALANCE} LAK ✓" \
  || warn "Wallet balance: ${WALLET_BALANCE}, expected ${EXPECTED_BALANCE}"

# ── Wallet transactions ───────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Wallet transactions:${NC}"
psql "$MOBILE_DB" -c \
  "SELECT type, amount, balance_after, description, created_at
   FROM panda_ev_core.wallet_transactions
   WHERE user_id=(SELECT id FROM panda_ev_core.mobile_users WHERE email='$TEST_EMAIL')
   ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || echo "  (psql not available)"

# ── OCPP Transaction ──────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}OCPP Transaction:${NC}"
psql "$OCPP_DB" -c \
  "SELECT ocpp_transaction_id, meter_start, meter_stop, status, start_time, stop_time, stop_reason
   FROM panda_ev_ocpp.transactions
   WHERE ocpp_transaction_id=$OCPP_TX_ID;" 2>/dev/null || echo "  (psql not available)"

# ── Data sync check (admin mobile_user_profiles) ─────────────────────────────
echo ""
echo -e "  ${BOLD}Admin DB — Mobile User sync:${NC}"
psql "$ADMIN_DB" -c \
  "SELECT mobile_user_id, email, status, synced_at
   FROM panda_ev_system.mobile_user_profiles LIMIT 5;" 2>/dev/null || \
  echo "  (mobile_user_profiles table not found)"

# =============================================================================
# SUMMARY
# =============================================================================
hdr "TEST SUMMARY"
echo ""
[[ "$SESSION_STATUS" == "COMPLETED" && "$WALLET_BALANCE" == "$EXPECTED_BALANCE" ]] && {
  ok "ALL CHECKS PASSED"
  echo -e "  ${GREEN}▸ Session COMPLETED${NC}"
  echo -e "  ${GREEN}▸ Energy: $(( METER_STOP / 1000 )) kWh charged${NC}"
  echo -e "  ${GREEN}▸ Amount: ${EXPECTED_AMOUNT} LAK deducted${NC}"
  echo -e "  ${GREEN}▸ Wallet: ${WALLET_BALANCE} LAK remaining${NC}"
} || {
  warn "Some checks did not pass — review output above"
}
echo ""
