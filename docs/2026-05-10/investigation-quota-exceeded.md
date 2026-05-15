# Investigation: GKE Cluster Quota Exceeded

**Date:** Sunday, May 10, 2026
**Project:** pandaev
**Cluster:** panda-ev-cluster (GKE Autopilot)
**Region:** asia-southeast1

## 1. Problem Identification
The `panda-ev-cluster` is experiencing scale-up failures. The cluster autoscaler is unable to provision new nodes due to a Google Cloud Platform (GCP) quota limitation.

**Error Message:**
> `Failed adding nodes ... due to OutOfResource.QUOTA_EXCEEDED; source errors: Instance creation failed: Quota 'SSD_TOTAL_GB' exceeded. Limit: 500.0 in region asia-southeast1.`

## 2. Analysis of Current Quota Usage
Investigation of the regional quotas for `asia-southeast1` revealed the following:

- **Metric:** `SSD_TOTAL_GB`
- **Current Limit:** 500.0 GB
- **Current Usage:** 370.0 GB (3 nodes active)

### Breakdown of Usage:
1. **GKE Autopilot Nodes:** 
   - Current Nodes: 3
   - Boot Disk per Node: 100 GB (Standard for GKE)
   - Total Node Disk Usage: **300 GB**
2. **Persistent Volume Claims (PVCs):**
   - `data-panda-rabbitmq-0`: 20 GB (`pd-ssd`)
   - `rabbitmq-data-rabbitmq-0`: 50 GB (`pd-balanced`)
   - Total PVC Usage: **70 GB**
3. **Total Current Usage:** 300 GB + 70 GB = **370 GB**

## 3. The Bottleneck
When the cluster needs to scale up to handle more load:
- Adding a 4th node would bring usage to **470 GB**.
- Adding a 5th node would require **570 GB**, which exceeds the **500 GB** limit.
- Because GKE Autopilot manages node provisioning dynamically, it may attempt to provision multiple nodes at once or maintain a buffer, causing it to hit the limit immediately.

## 4. Recommended Actions
To resolve this issue and allow the cluster to scale properly, follow these steps:

### Step 1: Request Quota Increase
1. Go to the [GCP Console Quotas page](https://console.cloud.google.com/iam-admin/quotas).
2. Filter for:
   - **Service:** Compute Engine API
   - **Metric:** `SSD_TOTAL_GB`
   - **Region:** `asia-southeast1`
3. Select the quota and click **EDIT QUOTAS**.
4. Request a new limit of **1,000 GB** (or higher depending on expected growth).
5. Provide a justification (e.g., "GKE Autopilot cluster scaling for production workload").

### Step 2: Monitor Cluster Events
After the quota is increased, the cluster should automatically scale up. You can monitor the progress with:
```bash
kubectl get events --all-namespaces --sort-by='.lastTimestamp' | grep -i ScaleUp
```

### Step 3: Verify Node Status
Confirm that the new nodes are provisioned and "Ready":
```bash
kubectl get nodes
```
