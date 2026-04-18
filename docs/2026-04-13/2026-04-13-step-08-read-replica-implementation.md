# Step 08: Read Replica Deployment Implementation (April 13, 2026)

## Progress Report
Successfully implemented the infrastructure support for Read Replicas (Master-Slave) within the Panda EV platform. This configuration allows for horizontal scaling of the database layer by offloading read traffic from the primary instance.

---

### **Implementation Details (Master-Slave)**
- **Service Refactored:** `panda-ev-client-mobile` (Mobile API).
- **Architecture Change:** Added a second **Cloud SQL Auth Proxy** sidecar container to the production deployment.
- **Port Mapping:**
  - **5432 (Localhost):** Routes to the **Primary/Master** Cloud SQL instance (Read/Write).
  - **5433 (Localhost):** Routes to the **Read Replica/Slave** Cloud SQL instance (Read Only).
- **Environment Integration:** Added `DATABASE_REPLICA_URL` to the environment variables to allow the application to connect to the slave database.

---

### **Infrastructure Schema**
```bash
Deployment: panda-mobile-api
├── Container: panda-mobile-api (NestJS)
├── Container: cloud-sql-proxy-master  (Port 5432 -> Master DB)
└── Container: cloud-sql-proxy-replica (Port 5433 -> Slave DB)
```

---

### **Next Step: Batch Implementation for All Services**
The next step is to apply this Read Replica pattern across all remaining Panda EV services (`ocpp`, `admin`, `gateway`, `notification`). This will involve:
1. Updating each service's `overlays/prod/kustomization.yaml`.
2. Ensuring that the correct replica instance name (e.g., `-replica`) is used for each service.
3. Providing example documentation for the development team on how to use `DATABASE_REPLICA_URL` in their NestJS/Prisma code.
