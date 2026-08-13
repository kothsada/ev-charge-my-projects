#!/bin/bash

# ==============================================================================
# Panda EV — DEV Cloud SQL Instance Creator (PostgreSQL 17)
# Edition: ENTERPRISE (Supports Custom Tiers)
# Region: asia-southeast1 (Singapore) — ດຽວກັນກັບ prod ເພື່ອຢູ່ VPC ດຽວກັນ
# Network: projects/pandaev/global/networks/panda-ev-vpc
#
# ສ້າງ 2026-08-12 — Cloud SQL instance ແຍກສະເພາະ panda-ev-dev namespace.
# ບໍ່ແຕະ instance prod ໃດເລີຍ (ຊື່ instance ຄົນລະຊຸດ, ບໍ່ຊ້ຳກັບ prod).
#
# ⚠️ NOT RUN YET — ນີ້ແມ່ນ command ກຽມໄວ້, review ຄ່າ tier/disk ກ່ອນ run ຈິງ.
# Run: chmod +x create-dev-db-instances.sh && ./create-dev-db-instances.sh
# ==============================================================================

set -euo pipefail

PROJECT_ID="pandaev"
REGION="asia-southeast1"
VPC_NETWORK="projects/pandaev/global/networks/panda-ev-vpc"
DB_VERSION="POSTGRES_17"

# ຂະໜາດ dev — ນ້ອຍກວ່າ prod ຫຼາຍ (prod = db-custom-2-8192, 2vCPU/8GB REGIONAL/ZONAL)
# ປັບໄດ້ຕາມ load ຈິງ — dev/test traffic ຕ່ຳ, ບໍ່ຈຳເປັນຕ້ອງ HA
DEV_TIER="db-custom-1-3840"       # 1 vCPU / 3.75 GB — tier custom ນ້ອຍສຸດ, ໃຊ້ໄດ້ກັບ ENTERPRISE edition
DEV_AVAILABILITY="ZONAL"          # dev ບໍ່ຕ້ອງການ REGIONAL failover
DEV_DISK_SIZE="10"                # GB, storage-auto-increase ຈະຂະຫຍາຍໃຫ້ເອງຖ້າເຕັມ

echo "------------------------------------------------------------"
echo "STARTING DEV DATABASE INSTANCE CREATION (PG 17 ENTERPRISE)"
echo "Tier: $DEV_TIER | Availability: $DEV_AVAILABILITY | Disk: ${DEV_DISK_SIZE}GB"
echo "------------------------------------------------------------"

# 1. System Admin (dev)
echo "Creating: panda-ev-instance-system-db-dev..."
gcloud sql instances create panda-ev-instance-system-db-dev \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=$DEV_TIER \
    --edition=ENTERPRISE \
    --availability-type=$DEV_AVAILABILITY \
    --storage-size=$DEV_DISK_SIZE \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --backup-start-time=03:00 \
    --retained-backups-count=3 \
    --async

# 2. Mobile API (dev)
echo "Creating: panda-ev-instance-mobile-db-dev..."
gcloud sql instances create panda-ev-instance-mobile-db-dev \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=$DEV_TIER \
    --edition=ENTERPRISE \
    --availability-type=$DEV_AVAILABILITY \
    --storage-size=$DEV_DISK_SIZE \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --backup-start-time=03:00 \
    --retained-backups-count=3 \
    --async

# 3. OCPP (dev)
echo "Creating: panda-ev-instance-ocpp-db-dev..."
gcloud sql instances create panda-ev-instance-ocpp-db-dev \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=$DEV_TIER \
    --edition=ENTERPRISE \
    --availability-type=$DEV_AVAILABILITY \
    --storage-size=$DEV_DISK_SIZE \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --backup-start-time=03:00 \
    --retained-backups-count=3 \
    --async

# 4. Core — Gateway + Notification schemas (dev)
echo "Creating: panda-ev-instance-core-db-dev..."
gcloud sql instances create panda-ev-instance-core-db-dev \
    --database-version=$DB_VERSION \
    --region=$REGION \
    --tier=$DEV_TIER \
    --edition=ENTERPRISE \
    --availability-type=$DEV_AVAILABILITY \
    --storage-size=$DEV_DISK_SIZE \
    --storage-auto-increase \
    --no-assign-ip \
    --network=$VPC_NETWORK \
    --database-flags timezone=Asia/Vientiane \
    --backup-start-time=03:00 \
    --retained-backups-count=3 \
    --async

echo "------------------------------------------------------------"
echo "Check progress: gcloud sql instances list --filter=\"name~-dev$\""
echo "------------------------------------------------------------"
echo ""
echo "!!! NEXT STEPS (ຫຼັງ instance ຂຶ້ນ RUNNABLE) !!!"
echo "------------------------------------------------------------"
echo "1. ຕັ້ງ postgres root password ຕໍ່ instance (ເບິ່ງ doc ຄຳແນະນຳ §3)"
echo "2. Run scripts/init/01-04-init-*.sql ຕໍ່ instance ຜ່ານ cloud-sql-proxy (ໃຊ້ scripts ເກົ່າໄດ້ເລີຍ, ບໍ່ຕ້ອງແກ້)"
echo "3. ແກ້ 5 dev overlay kustomization.yaml ໃຫ້ຊີ້ໄປ instance ຊື່ໃໝ່ນີ້ (ເບິ່ງ doc §5 — ມີຈຸດເພີ່ມສຳຄັນສຳລັບ system-admin)"
echo "------------------------------------------------------------"
