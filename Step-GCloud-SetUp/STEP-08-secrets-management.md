# Step 08: Secrets Management 🔐

## ຈຸດປະສົງ (Objective)
ເພື່ອອອກແບບ ແລະ ຕັ້ງຄ່າການຈັດການຄວາມລັບ (Secrets) ໃນລະດັບ Production ໂດຍໃຊ້ **Google Cloud Secret Manager** ຮ່ວມກັບ **External Secrets Operator (ESO)** ໃນ GKE. ວິທີນີ້ຈະຊ່ວຍໃຫ້ເຮົາຈັດເກັບ Secret ໄວ້ບ່ອນດຽວ (Centralized) ແລະ ມີຄວາມປອດໄພສູງກວ່າການເກັບໄວ້ໃນ K8s Secret ແບບທຳມະດາ.

## 1. GCP Secret Manager Setup
ເຮົາຈະສ້າງ Secret ໃນ GCP ໂດຍແຍກຕາມຄວາມປອດໄພ ແລະ ການໃຊ້ງານ:

| Secret Name (GCP) | Description |
| :--- | :--- |
| `prod-db-credentials` | Username, Password, ແລະ Host ຂອງ Cloud SQL |
| `prod-redis-credentials` | AUTH Password ຂອງ Memorystore |
| `prod-rabbitmq-credentials` | Username/Password ຂອງ RabbitMQ Cluster |
| `prod-jwt-keys` | JWT Secret, Refresh Token Secret |
| `prod-service-keys` | API Keys, FCM Credentials, BCEL Keys |

## 2. External Secrets Operator (ESO) Config
ເຮົາຈະໃຊ້ ESO ເພື່ອດຶງຂໍ້ມູນຈາກ GCP Secret Manager ມາສ້າງເປັນ K8s Secret ອັດຕະໂນມັດ.

### Step 2.1: ສ້າງ ClusterSecretStore
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: gcp-store
spec:
  provider:
    gcpsm:
      projectID: pandaev
      auth:
        workloadIdentity:
          clusterLocation: asia-southeast1
          clusterName: panda-ev-cluster
```

### Step 2.2: ສ້າງ ExternalSecret (ຕົວຢ່າງສຳລັບ Mobile API)
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: mobile-api-secrets
  namespace: panda-ev-prod
spec:
  refreshInterval: 1h # ອັບເດດທຸກໆ 1 ຊົ່ວໂມງ
  secretStoreRef:
    kind: ClusterSecretStore
    name: gcp-store
  target:
    name: mobile-api-k8s-secret # ຊື່ K8s Secret ທີ່ຈະຖືກສ້າງ
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod-db-credentials
        property: mobile_db_pass
    - secretKey: JWT_SECRET
      remoteRef:
        key: prod-jwt-keys
        property: access_token_secret
    - secretKey: REDIS_PASS
      remoteRef:
        key: prod-redis-credentials
```

## 3. Secret Mapping ທຸກ Service (Summary)

- **Admin Service:** `admin_db_pass`, `jwt_secret`, `service_account_json`
- **Mobile API:** `mobile_db_pass`, `jwt_secret`, `redis_pass`, `otp_secret`
- **OCPP CSMS:** `ocpp_db_pass`, `redis_pass`
- **Notification:** `noti_db_pass`, `fcm_server_key`, `redis_pass`
- **Gateway:** `gateway_db_pass`, `bcel_api_key`, `bcel_private_key`, `idempotency_secret`

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ອອກແບບໂຄງສ້າງການເກັບ Secret ໃນ GCP Secret Manager.
- [x] ຕັ້ງຄ່າ `ClusterSecretStore` ເພື່ອເຊື່ອມຕໍ່ GKE ຫາ GCP.
- [x] ສ້າງ `ExternalSecret` Manifests ສຳລັບທຸກ 5 Services.
- [x] ກຳນົດ Workload Identity ສຳລັບ Service Account ໃນ GKE.
- [x] ກວດສອບຄວາມຖືກຕ້ອງຂອງ Secret Mapping ຕາມຄວາມຕ້ອງການຂອງແຕ່ລະ Service.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Workload Identity:** ຕ້ອງໝັ້ນໃຈວ່າ GKE Service Account (KSA) ຖືກຜູກກັບ GCP Service Account (GSA) ທີ່ມີສິດ `roles/secretmanager.secretAccessor`.
- **Secret Versioning:** ຖ້າເຮົາອັບເດດ Secret ໃນ GCP, ຕ້ອງມີການ Rollout Restart Pod ເພື່ອໃຫ້ App ຮັບຄ່າໃໝ່ (ESO ຈະອັບເດດ K8s Secret ແຕ່ App ທີ່ run ຢູ່ອາດຈະຍັງໃຊ້ຄ່າເກົ່າ).
- **No Hardcoding:** ຫ້າມ Hardcode Password ຫຼື Keys ລົງໃນ ConfigMap ຫຼື Deployment YAML ເດັດຂາດ.
- **Audit Logs:** ເປີດໃຊ້ Data Access Logs ໃນ GCP ເພື່ອຕິດຕາມວ່າໃຜ/Service ໃດ ເຂົ້າມາອ່ານ Secret ຂອງເຮົາ.

---
✅ Step 08 ສຳເລັດ — ບັນທຶກໃສ່ STEP-08-secrets-management.md
