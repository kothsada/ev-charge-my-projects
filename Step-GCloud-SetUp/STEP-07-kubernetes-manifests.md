# Step 07: Kubernetes Production Manifests ☸️

## ຈຸດປະສົງ (Objective)
ເພື່ອສ້າງ Kubernetes Manifests (YAML) ທີ່ພ້ອມໃຊ້ງານໃນລະດັບ Production ສຳລັບທຸກ 5 Services ຂອງ Panda EV Hub. ໂດຍທຸກ Deployment ຈະມີ Cloud SQL Auth Proxy ເປັນ Sidecar ແລະ ມີການຕັ້ງຄ່າ Resource limits, Probes, ແລະ HPA ຢ່າງຖືກຕ້ອງ.

---

## 1. ຕົວຢ່າງ Deployment Template (ສຳລັບ Stateless Services)
ໃຊ້ສຳລັບ: Admin, Mobile, Gateway, ແລະ Notification.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: panda-ev-mobile-api
  namespace: panda-ev-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mobile-api
  template:
    metadata:
      labels:
        app: mobile-api
    spec:
      containers:
        # 1. Main Application Container (NestJS)
        - name: app
          image: gcr.io/pandaev/mobile-api:v1.0.0
          ports:
            - containerPort: 4001
          envFrom:
            - configMapRef:
                name: mobile-api-config
            - secretRef:
                name: mobile-api-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /api/mobile/v1/health
              port: 4001
            initialDelaySeconds: 15
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/mobile/v1/health
              port: 4001
            initialDelaySeconds: 30
            periodSeconds: 20

        # 2. Cloud SQL Auth Proxy Sidecar
        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8.1
          args:
            - "--private-ip"
            - "--port=5432"
            - "pandaev:asia-southeast1:panda-ev-prod-mobile-db"
          securityContext:
            runAsNonRoot: true
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

---

## 2. OCPP CSMS Deployment (Stateful / Special Handling)
OCPP ຈະມີ **PgBouncer** ເພີ່ມເຂົ້າມາເພື່ອຈັດການ Connection.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: panda-ev-ocpp-csms
  namespace: panda-ev-prod
spec:
  replicas: 3
  template:
    spec:
      terminationGracePeriodSeconds: 60 # ໃຫ້ເວລາ WebSocket ປິດ
      nodeSelector:
        pool: ocpp-pool # ແລ່ນສະເພາະ OCPP Pool
      containers:
        - name: ocpp-app
          image: gcr.io/pandaev/ocpp-csms:v1.0.0
          ports:
            - containerPort: 4002
          env:
            - name: DATABASE_URL
              value: "postgres://user:pass@127.0.0.1:6432/panda_ev_ocpp" # ຊີ້ຫາ PgBouncer
          resources:
            requests:
              cpu: "1000m"
              memory: "2Gi"
            limits:
              cpu: "2000m"
              memory: "4Gi"

        # PgBouncer Sidecar
        - name: pgbouncer
          image: edoburu/pgbouncer:latest
          args: ["/etc/pgbouncer/pgbouncer.ini"]
          ports:
            - containerPort: 6432

        # Cloud SQL Proxy Sidecar
        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8.1
          args:
            - "--private-ip"
            - "--port=5432"
            - "pandaev:asia-southeast1:panda-ev-prod-ocpp-db"
```

---

## 3. Service & Ingress (Example for Mobile API)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mobile-api-service
  namespace: panda-ev-prod
spec:
  selector:
    app: mobile-api
  ports:
    - protocol: TCP
      port: 80
      targetPort: 4001
  type: ClusterIP # ໃຊ້ ClusterIP ເພື່ອໃຫ້ Ingress ມາຮັບ Load
```

---

## 4. ConfigMap & Secret Mapping
ທຸກ Service ຕ້ອງມີ ConfigMap ສຳລັບ Non-sensitive data.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: global-config
  namespace: panda-ev-prod
data:
  REDIS_HOST: "10.x.x.x" # Memorystore Private IP
  RABBITMQ_HOST: "panda-ev-rabbitmq-prod"
  NODE_ENV: "production"
```

---

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ສ້າງ Deployment YAML ພ້ອມ Cloud SQL Proxy sidecar ທຸກ Service.
- [x] ເພີ່ມ PgBouncer sidecar ສຳລັບ OCPP Service.
- [x] ກຳນົດ Resource Requests/Limits ແລະ Probes ໃຫ້ທຸກ Pod.
- [x] ສ້າງ Service (ClusterIP) ເພື່ອຮອງຮັບ Traffic ພາຍໃນ Cluster.
- [x] ຈັດກຸ່ມ ConfigMap ແລະ Secrets ໃຫ້ເປັນລະບົບ.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Health Checks:** ຕ້ອງມີ Endpoint `/health` ໃນ NestJS ທີ່ກວດສອບທັງ DB ແລະ Redis Connection.
- **Sidecar Lifecycle:** Pod ຈະຖືວ່າ Ready ກໍ່ຕໍ່ເມື່ອທຸກ Container (App + Proxy) ຜ່ານ Readiness Probe.
- **Image Version:** ໃນ Production ຫ້າມໃຊ້ `:latest` ເດັດຂາດ. ໃຫ້ໃຊ້ Tag version ທີ່ຊັດເຈນ (ເຊັ່ນ `:v1.0.1`).
- **Graceful Shutdown:** NestJS ຕ້ອງຮອງຮັບ `SIGTERM` ເພື່ອປິດ Connection ຕ່າງໆ ຢ່າງປອດໄພ.

---
✅ Step 07 ສຳເລັດ — ບັນທຶກໃສ່ STEP-07-kubernetes-manifests.md
