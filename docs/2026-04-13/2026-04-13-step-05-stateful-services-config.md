# Step 05: Stateful Service Migration - Redis & RabbitMQ (April 13, 2026)

## Progress Report
Successfully refactored the configuration for stateful services (Redis and RabbitMQ) into a Kustomize structure. This setup ensures data persistence and provides a clear path for using Google Cloud Memorystore in Production.

---

### **Infrastructure Refactored**
#### **1. Redis**
- **Directory:** `kubernetes/infrastructure/stateful/redis/`
- **Dev Overlay:** Continues to use a containerized Redis instance in GKE for cost efficiency.
- **Prod Overlay:** Configured to point to **Google Cloud Memorystore for Redis**. It uses a Kubernetes `Service` and `Endpoints` to map the Memorystore Private IP to the internal `redis-service` name.

#### **2. RabbitMQ**
- **Directory:** `kubernetes/infrastructure/stateful/rabbitmq/`
- **Hardening:** Migrated from a standard `Deployment` to a **`StatefulSet`**.
- **Persistence:** Added `volumeClaimTemplates` to ensure that RabbitMQ data is stored on Persistent Volumes (Standard PD in Dev, likely SSD in Prod).
- **Resources:** Scaled production limits to 2GiB RAM and 50GiB storage for increased message durability.

---

### **Environment Matrix**
| Service | Component | Dev (panda-ev-dev) | Prod (panda-ev-prod) |
|---------|-----------|--------------------|----------------------|
| Redis | Logic | GKE Container (redis:7.2) | Google Memorystore (Managed) |
| RabbitMQ | Logic | GKE StatefulSet (1 Replica) | GKE StatefulSet (1 Replica, Hardened) |
| Storage | Redis | Ephemeral/EmptyDir | Managed by Google |
| Storage | RabbitMQ | 10GiB Persistent Volume | 50GiB Persistent Volume |

---

### **Next Step: Automated Deployment and Verification**
The next step is to prepare the final deployment sequence. This involves:
1. Creating a root `kustomization.yaml` for both `dev` and `prod` that aggregates all services and infrastructure.
2. Generating a validation script to ensure that all services in the new namespaces can connect to their respective databases, Redis, and RabbitMQ.
3. Updating the GitHub Actions workflows to use these new Kustomize overlays during the CI/CD process.
