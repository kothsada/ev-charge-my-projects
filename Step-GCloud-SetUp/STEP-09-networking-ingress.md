# Step 09: Networking & Ingress (Production) 🌐

## ຈຸດປະສົງ (Objective)
ເພື່ອອອກແບບ ແລະ ຕັ້ງຄ່າລະບົບເຄືອຂ່າຍ (Networking) ແລະ ການເຂົ້າເຖິງລະບົບຈາກພາຍນອກ (Ingress) ໂດຍໃຊ້ **Google Cloud Load Balancer (GCLB)**. ເນັ້ນການເຮັດ SSL/TLS Termination, ການ Routing ຕາມ URL Prefix, ແລະ ທີ່ສຳຄັນທີ່ສຸດຄືການຮອງຮັບ **OCPP WebSocket (WSS)** ພ້ອມ Sticky Sessions.

## 1. Google-Managed SSL Certificates
ເຮົາຈະໃຊ້ Certificate ທີ່ Google ຈັດການໃຫ້ອັດຕະໂນມັດ (Auto-renew).

```yaml
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: panda-ev-managed-cert
  namespace: panda-ev-prod
spec:
  domains:
    - api.pandaev.com     # Domain ສຳລັບ Mobile/Gateway/Admin
    - ocpp.pandaev.com    # Domain ພິເສດສຳລັບ OCPP WebSocket
```

## 2. BackendConfig ສຳລັບ Sticky Sessions (OCPP)
ເພື່ອໃຫ້ WebSocket ຂອງ Charger ເຊື່ອມຕໍ່ຫາ Pod ເດີມສະເໝີ ແລະ ບໍ່ຫຼຸດການເຊື່ອມຕໍ່ໄວເກີນໄປ.

```yaml
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: ocpp-backend-config
  namespace: panda-ev-prod
spec:
  sessionAffinity:
    affinityType: "GENERATED_COOKIE"
    affinityCookieTtlSec: 86400 # 24 ຊົ່ວໂມງ
  timeoutSec: 3600 # ປ່ຽນ Timeout ເປັນ 1 ຊົ່ວໂມງ (ປ້ອງກັນ WebSocket ຫຼຸດທຸກ 30s)
  healthCheck:
    checkIntervalSec: 10
    port: 4002
    type: HTTP
    requestPath: /health
```

## 3. GKE Ingress Configuration (Production-Ready)
ໃຊ້ GCLB (L7 Load Balancer) ເພື່ອແຍກ Traffic ຕາມ Host ແລະ Path.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: panda-ev-ingress
  namespace: panda-ev-prod
  annotations:
    kubernetes.io/ingress.class: "gce"
    kubernetes.io/ingress.global-static-ip-name: "panda-ev-static-ip"
    networking.gke.io/managed-certificates: "panda-ev-managed-cert"
    kubernetes.io/ingress.allow-http: "false" # ບັງຄັບ HTTPS ເທົ່ານັ້ນ
spec:
  rules:
    # 1. Host ສຳລັບ APIs ທົ່ວໄປ
    - host: api.pandaev.com
      http:
        paths:
          - path: /api/admin/v1/*
            pathType: ImplementationSpecific
            backend:
              service:
                name: admin-api-service
                port:
                  number: 80
          - path: /api/mobile/v1/*
            pathType: ImplementationSpecific
            backend:
              service:
                name: mobile-api-service
                port:
                  number: 80
          - path: /api/gateway/v1/*
            pathType: ImplementationSpecific
            backend:
              service:
                name: gateway-service
                port:
                  number: 80

    # 2. Host ພິເສດສຳລັບ OCPP WebSocket (WSS)
    - host: ocpp.pandaev.com
      http:
        paths:
          - path: /ocpp/*
            pathType: ImplementationSpecific
            backend:
              service:
                name: ocpp-csms-service
                port:
                  number: 80
```

## 4. Internal Communication (ClusterIP)
ການສື່ສານລະຫວ່າງ Services ພາຍໃນ Cluster (ເຊັ່ນ Mobile API ເອີ້ນຫາ Admin DB ຜ່ານ Proxy ຫຼື ເອີ້ນຫາ Notification) ຈະໃຊ້ **ClusterIP Service Name** ເພື່ອໃຫ້ Latency ຕໍ່າທີ່ສຸດ ແລະ ປອດໄພ.
- ຕົວຢ່າງ: `http://notification-service.panda-ev-prod.svc.cluster.local`

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ສ້າງ `ManagedCertificate` ສຳລັບທຸກ Domains.
- [x] ຕັ້ງຄ່າ `BackendConfig` ເພື່ອຮອງຮັບ Sticky Session ແລະ Long-timeout WebSocket.
- [x] ອອກແບບ Ingress Routing ແຍກຕາມ Host ແລະ API Path.
- [x] ຕັ້ງຄ່າ Static IP ໃນ GCP ແລະ ຜູກກັບ Ingress Annotation.
- [x] ກວດສອບ SSL Termination (HTTPS/WSS) ໃຫ້ເຮັດວຽກໄດ້ຖືກຕ້ອງ.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **WebSocket Timeout:** ໂດຍປົກກະຕິ GCLB ຈະມີ Timeout 30 ວິນາທີ. ຖ້າບໍ່ປັບ `timeoutSec` ໃນ `BackendConfig`, WebSocket ຂອງ Charger ຈະຫຼຸດທຸກໆ 30 ວິນາທີ.
- **SSL Propagation:** ຫຼັງຈາກສ້າງ Managed Certificate, ອາດຈະຕ້ອງລໍຖ້າ 20-60 ນາທີ ເພື່ອໃຫ້ Google ສ້າງ ແລະ ຜູກ Cert ໃຫ້ສຳເລັດ.
- **WSS Protocol:** Charger ຕ້ອງເຊື່ອມຕໍ່ຫາ `wss://ocpp.pandaev.com/ocpp/identity` (WSS ເທົ່ານັ້ນ, ຫ້າມໃຊ້ WS ໃນ Production).
- **Service Port:** ໃຫ້ Ingress ເຂົ້າຫາ Port 80 ຂອງ Service ເຊິ່ງຈະ Target ໄປຫາ Port ຂອງ App (ເຊັ່ນ 4001, 4002) ອີກເທື່ອໜຶ່ງ.

---
✅ Step 09 ສຳເລັດ — ບັນທຶກໃສ່ STEP-09-networking-ingress.md
