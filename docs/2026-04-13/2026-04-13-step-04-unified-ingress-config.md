# Step 04: Unified Ingress and SSL Configuration (April 13, 2026)

## Progress Report
Successfully refactored the global Ingress and SSL (Managed Certificate) configuration into Kustomize. This ensures that both Development and Production environments have their own load-balancing and SSL termination logic.

---

### **Infrastructure Refactored**
- **Directory:** `kubernetes/infrastructure/ingress/`
- **Base Components:** 
  - `ingress.yaml`: Global GCE Ingress template.
  - `managed-cert.yaml`: Google-managed SSL Certificate template.
- **Overlays:**
  - **Dev (`panda-ev-dev`)**: Uses development domains (`dev-*.pandaev.cc`) and an ephemeral external IP for testing.
  - **Prod (`panda-ev-prod`)**: Uses production domains (`*.pandaev.cc`) and the reserved static IP `panda-api-ip`.

---

### **Routing Rules (Per Environment)**
| Environment | Domain Prefix | Namespace | Backend Service |
|-------------|---------------|-----------|-----------------|
| Dev | `dev-admin-api` | `panda-ev-dev` | `panda-system-api-service` |
| Dev | `dev-api` | `panda-ev-dev` | `panda-mobile-api-service` |
| Dev | `dev-gateway-api` | `panda-ev-dev` | `panda-gateway-api-service` |
| Prod | `admin-api` | `panda-ev-prod` | `panda-system-api-service` |
| Prod | `api` | `panda-ev-prod` | `panda-mobile-api-service` |
| Prod | `gateway-api` | `panda-ev-prod` | `panda-gateway-api-service` |

---

### **Next Step: Stateful Service Migration (RabbitMQ/Redis)**
The next step is to configure the stateful services for the new namespaces. This involves:
1. Refactoring the RabbitMQ and Redis manifests into Kustomize.
2. Deciding on the storage strategy (Persistent Volumes) for both environments.
3. In Production, preparing the migration from self-managed Redis to **Google Cloud Memorystore**.
4. Ensuring inter-service connectivity between the application pods and these stateful services using internal Kubernetes DNS.
