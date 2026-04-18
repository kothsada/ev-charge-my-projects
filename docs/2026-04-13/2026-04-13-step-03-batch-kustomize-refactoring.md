# Step 03: Batch Kustomize Refactoring (April 13, 2026)

## Progress Report
Successfully completed the refactoring of all five Panda EV platform services into a hardened Kustomize structure. This migration provides a scalable way to manage environment-specific configurations for both Development and Production.

---

### **Services Refactored**
1. **`panda-ocpp-api`** (Template established earlier)
2. **`panda-ev-client-mobile`**
3. **`panda-ev-csms-system-admin`**
4. **`panda-ev-gateway-services`**
5. **`panda-ev-notification`**

---

### **Refactoring Details**
For each service, the following artifacts were created or migrated:
- **`base/`**: 
  - `deployment.yaml`: Core deployment spec without environment-specific hardcoding.
  - `service.yaml`: Internal ClusterIP service definition.
  - `serviceaccount.yaml`: Service Account for GKE Workload Identity.
  - `kustomization.yaml`: Centralized configuration for common metadata and `ConfigMap` generators.
- **`overlays/dev/`**:
  - `kustomization.yaml`: Patches for the `panda-ev-dev` namespace, development Cloud SQL instances, and `NODE_ENV="development"`.
- **`overlays/prod/`**:
  - `kustomization.yaml`: Patches for the `panda-ev-prod` namespace, production Cloud SQL instances, higher resource limits, and `NODE_ENV="production"`.

---

### **Current Kustomize Directory Structure**
```bash
kubernetes/services/
├── panda-ev-client-mobile/
├── panda-ev-csms-system-admin/
├── panda-ev-gateway-services/
├── panda-ev-notification/
└── panda-ocpp-api/
    ├── base/
    └── overlays/
        ├── dev/
        └── prod/
```

---

### **Next Step: Unified Ingress and SSL Configuration**
The next step is to refactor the global Ingress and SSL configuration into Kustomize. This will involve:
1. Creating a `kubernetes/infrastructure/` directory.
2. Refactoring `panda-ev-ingress.yaml` and `managed-cert.yaml` to support separate entries for Dev and Prod (e.g., `api.pandaev.cc` vs `dev.api.pandaev.cc`).
3. Configuring a Google Cloud Load Balancer (GCLB) that can route traffic to the appropriate service in each namespace.
