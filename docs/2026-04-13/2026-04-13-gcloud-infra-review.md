# GCP Infrastructure Review (April 13, 2026)

## Overview
Review of the current GCP configuration for the Panda EV platform to assess readiness for Development and Production environment separation.

---

### 1. GCloud Configuration
- **Project:** `pandaev`
- **Region/Zone:** `asia-southeast1` (Singapore) / `asia-southeast1-a`
- **Account:** `pandaev2026@gmail.com`

---

### 2. Networking (VPC & Subnets)
- **VPC Name:** `panda-ev-vpc`
- **Subnets:**
  - `gke-panda-ev-cluster-d4785851-pe-subnet`: 172.16.0.0/28
  - `private-panda-app-subnet`: 10.10.2.0/24 (GKE Nodes)
  - `private-panda-db-subnet`: 10.10.3.0/24
  - `public-panda-subnet`: 10.10.1.0/24
- **Managed Services Range:** `10.10.4.0/24` (Reserved for VPC Peering/Cloud SQL).

---

### 3. GKE Cluster (Autopilot)
- **Cluster Name:** `panda-ev-cluster`
- **Namespace:** `panda-ev` (Single namespace for all services)
- **Deployments in `panda-ev`:**
  - `panda-gateway-api`
  - `panda-mobile-api`
  - `panda-notification-api`
  - `panda-ocpp-api`
  - `panda-system-api`
  - `rabbitmq` (Self-managed)
  - `redis` (Self-managed)

---

### 4. Cloud SQL (PostgreSQL 18)
- Four instances currently active with Private IPs:
  - `panda-ev-core-instance-db-a1`
  - `panda-ev-ocpp-db`
  - `panda-ev-core-mobile-db`
  - `panda-ev-csms-system`

---

### 5. External Access & Load Balancing
- **Global Static IP (`panda-api-ip`):** `34.8.243.174` (Reserved for Ingress/GCLB).
- **NAT Gateway IP (`panda-ev-nat-ip`):** `34.126.166.249` (Regional).

---

### 6. Gap Analysis & Recommendations
1. **Environment Isolation:** Transition from a single `panda-ev` namespace to isolated namespaces: `panda-ev-dev` and `panda-ev-prod`.
2. **Kustomize Refactoring:** No `kustomization.yaml` files were found. All manifests should be refactored into base/overlay structures for multi-environment support.
3. **Database Migration:** Categorize Cloud SQL instances explicitly for Dev and Prod. 
4. **Managed Redis:** Transition from self-managed Redis in GKE to Memorystore for Redis (HA) in Production.
5. **Secret Management:** Currently using scripts for secrets; should consider migrating to GCP Secret Manager for Production hardening.

---

### Next Steps
1. Create `panda-ev-dev` and `panda-ev-prod` namespaces.
2. Refactor existing K8s manifests using Kustomize.
3. Establish a separate CI/CD pipeline for both environments.
