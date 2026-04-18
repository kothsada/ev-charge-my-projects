# Step 02: Kustomize Manifest Refactoring (April 13, 2026)

## Progress Report
Successfully initiated the refactoring of Kubernetes manifests into a Kustomize-based structure. This enables clean separation of configuration for Development and Production environments.

---

### **Tasks Completed**
1. **Directory Structure:** Established `kubernetes/services/panda-ocpp-api/` with `base/` and `overlays/dev`, `overlays/prod`.
2. **Base Manifests:** Created `deployment.yaml`, `service.yaml`, and `serviceaccount.yaml` in the `base` directory, removing hardcoded environment-specific values.
3. **Kustomize Base:** Configured `base/kustomization.yaml` with common environment variables and resource definitions.
4. **Environment Overlays:**
   - **Dev Overlay:** Configured for the `panda-ev-dev` namespace, using development database instances and specific Redis URLs.
   - **Prod Overlay:** Configured for the `panda-ev-prod` namespace, with increased resource limits and production-specific configuration.

---

### **Current Kustomize State (Example: OCPP)**
```bash
kubernetes/services/panda-ocpp-api/
├── base/
│   ├── deployment.yaml
│   ├── kustomization.yaml
│   ├── service.yaml
│   └── serviceaccount.yaml
└── overlays/
    ├── dev/
    │   └── kustomization.yaml
    └── prod/
        └── kustomization.yaml
```

---

### **Next Step: Batch Refactoring for Remaining Services**
The next step is to repeat this refactoring process for the remaining four services:
1. `panda-ev-client-mobile`
2. `panda-ev-csms-system-admin`
3. `panda-ev-gateway-services`
4. `panda-ev-notification`

Once all services are refactored, we will implement a unified Ingress configuration using Kustomize and prepare for the deployment of stateful services (RabbitMQ/Redis) into the new namespaces.
