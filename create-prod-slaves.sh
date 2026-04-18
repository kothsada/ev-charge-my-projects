#!/bin/bash

# ==============================================================================
# Panda EV — Production Read Replica (Slave) Creator
# ==============================================================================

REGION="asia-southeast1"

echo "------------------------------------------------------------"
echo "STARTING READ REPLICA CREATION (MOBILE & OCPP - ENTERPRISE)"
echo "------------------------------------------------------------"

# 1. ສ້າງ Slave ສໍາລັບ Mobile API
echo "Creating Read Replica for Mobile: panda-ev-instance-mobile-db-a2-replica..."
gcloud sql instances create panda-ev-instance-mobile-db-a2-replica \
    --master-instance-name=panda-ev-instance-mobile-db-a2 \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --database-flags timezone=Asia/Vientiane \
    --async

# 2. ສ້າງ Slave ສໍາລັບ OCPP API
echo "Creating Read Replica for OCPP: panda-ev-instance-ocpp-db-a2-replica..."
gcloud sql instances create panda-ev-instance-ocpp-db-a2-replica \
    --master-instance-name=panda-ev-instance-ocpp-db-a2 \
    --region=$REGION \
    --tier=db-custom-2-8192 \
    --edition=ENTERPRISE \
    --database-flags timezone=Asia/Vientiane \
    --async

echo "------------------------------------------------------------"
echo "Check progress via: gcloud sql instances list"
echo "------------------------------------------------------------"
