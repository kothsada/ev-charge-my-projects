#!/bin/bash

# ==============================================================================
# Panda EV — Production Cloud SQL Instance Creator (PostgreSQL 17)
# Edition: ENTERPRISE (Supports Custom Tiers)
# Region: asia-southeast1 (Singapore)
# Network: projects/pandaev/global/networks/panda-ev-vpc
#
# ອັບເດດ 2026-08-06: tier/availability ຂ້າງລຸ່ມນີ້ຖືກແກ້ໃຫ້ຕົງກັບ live prod ຈິງ
# (ກວດຢືນຢັນຜ່ານ `gcloud sql instances describe`) — ຄ່າເກົ່າໃນ script ນີ້ບໍ່ຕົງກັບ
# ສິ່ງທີ່ຖືກ apply ຈິງ (system-db/core-db ຖືກ resize ຂຶ້ນ, mobile-db/ocpp-db
# ຍັງບໍ່ໄດ້ upgrade ເປັນ REGIONAL — ອ້າງອີງ docs/2026-08-06/...Cloud_SQL_Backup_And_HA
# ຫຼື memory `project_cloud_sql_backup_ha`: ການ upgrade mobile/ocpp ເປັນ REGIONAL
# ຍັງເປັນ optional/ຄ້າງ, ບໍ່ແມ່ນ script ຜິດພາດ)
# ==============================================================================

PROJECT_ID="pandaev"
REGION="asia-southeast1"
VPC_NETWORK="projects/pandaev/global/networks/panda-ev-vpc"
DB_VERSION="POSTGRES_17"

echo "------------------------------------------------------------"
echo "STARTING PRODUCTION DATABASE INSTANCE CREATION (PG 17 ENTERPRISE)"
echo "------------------------------------------------------------"

# 1. System Admin (Master)
echo "Creating: panda-ev-instance-system-db-a2..."
gcloud sql instances create panda-ev-instance-system-db-a2 \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --availability-type=REGIONAL \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --async

# 2. Mobile API (Master)
# ⚠️ live prod ປັດຈຸບັນ = ZONAL (ບໍ່ແມ່ນ REGIONAL) — ບັນທຶກໄວ້ໃນ project_cloud_sql_backup_ha
# ວ່າການ upgrade ເປັນ REGIONAL ຍັງເປັນ optional/ຄ້າງ. ປ່ຽນເປັນ REGIONAL ຂ້າງລຸ່ມນີ້ໄດ້
# ຖ້າຢາກ deploy ໃໝ່ໃຫ້ HA ດີກວ່າ prod ປັດຈຸບັນ.
echo "Creating: panda-ev-instance-mobile-db-a2..."
gcloud sql instances create panda-ev-instance-mobile-db-a2 \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --availability-type=ZONAL \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --async

# 3. OCPP (Master)
# ⚠️ live prod ປັດຈຸບັນ = ZONAL (ຄືເຫດຜົນດຽວກັນກັບ mobile-db ຂ້າງເທິງ)
echo "Creating: panda-ev-instance-ocpp-db-a2..."
gcloud sql instances create panda-ev-instance-ocpp-db-a2 \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --availability-type=ZONAL \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --async

# 4. Core (Gateway/Notification) (Master)
echo "Creating: panda-ev-instance-core-db-a2..."
gcloud sql instances create panda-ev-instance-core-db-a2 \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --availability-type=REGIONAL \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --async

echo "------------------------------------------------------------"
echo "Check progress in GCP Console or via: gcloud sql instances list"
echo "------------------------------------------------------------"
echo ""
echo "!!! IMPORTANT: NEXT STEPS REQUIRED !!!"
echo "------------------------------------------------------------"
echo "After the instances reach 'RUNNABLE' status, you MUST:"
echo "1. Set the password for the 'postgres' user for each instance."
echo "2. Run the SQL initialization scripts found in scripts/init/"
echo ""
echo "Follow the step-by-step guide here:"
echo "docs/2026-04-14/2026-04-14-step-11-db-password-setup.md"
echo "------------------------------------------------------------"
