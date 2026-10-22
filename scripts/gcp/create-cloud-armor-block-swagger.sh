#!/bin/bash
# ສ້າງ Cloud Armor policy ບລັອກ Swagger (/api/{admin,mobile,gateway}/docs*) ຈາກ internet.
# ຕ້ອງ run ກ່ອນ apply BackendConfig ທີ່ອ້າງ securityPolicy. Idempotent.
# Usage: ./create-cloud-armor-block-swagger.sh
set -euo pipefail
PROJECT=pandaev
POLICY=panda-block-swagger

gcloud compute security-policies describe $POLICY --project=$PROJECT >/dev/null 2>&1 || \
  gcloud compute security-policies create $POLICY --project=$PROJECT \
    --description="Block public Swagger docs; allow everything else"

# rule 1000: deny 404 ສຳລັບ path docs
gcloud compute security-policies rules describe 1000 --security-policy=$POLICY --project=$PROJECT >/dev/null 2>&1 || \
  gcloud compute security-policies rules create 1000 --security-policy=$POLICY --project=$PROJECT \
    --action=deny-404 \
    --expression="request.path.matches('^/api/[a-z]+/docs.*')" \
    --description="Block swagger UI/json"

# default rule (2147483647) ຕ້ອງເປັນ allow
gcloud compute security-policies rules update 2147483647 --security-policy=$POLICY --project=$PROJECT --action=allow
gcloud compute security-policies describe $POLICY --project=$PROJECT --format="yaml(rules)"
