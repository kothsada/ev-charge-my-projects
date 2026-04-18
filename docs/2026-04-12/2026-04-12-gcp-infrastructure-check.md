# GCP Infrastructure Report - 2026-04-12

## Summary
The current GCP project configuration and active development instances have been verified.

## GCP Configuration
- **Region:** `asia-southeast1`
- **Zone:** `asia-southeast1-a`
- **Project ID:** `pandaev`

## Active Development Instances (GKE)
The following instances are active within the GKE Autopilot cluster:

| Resource Type | Name | Location | Status |
| :--- | :--- | :--- | :--- |
| **GKE Cluster** | `panda-ev-cluster` | `asia-southeast1` | RUNNING |
| **Node Instance 1** | `gk3-panda-ev-cluster-pool-1-d59d7c53-gbdc` | `asia-southeast1` | READY |
| **Node Instance 2** | `gk3-panda-ev-cluster-pool-1-e0eb6b8b-tfpd` | `asia-southeast1` | READY |
| **SQL Instance** | `panda-ev-core-instance-db-a1` | `asia-southeast1-c` | RUNNABLE |
| **SQL Instance** | `panda-ev-ocpp-db` | `asia-southeast1-c` | RUNNABLE |
| **SQL Instance** | `panda-ev-core-mobile-db` | `asia-southeast1-a` | RUNNABLE |
| **SQL Instance** | `panda-ev-csms-system` | `asia-southeast1-a` | RUNNABLE |

## Verification Steps
1. **Check Region:** Ran `gcloud config list` to verify the default compute region.
2. **List Instances:** Ran `gcloud compute instances list` (returned 0 for standalone VMs).
3. **List GKE Clusters:** Ran `gcloud container clusters list` to identify active clusters.
4. **Fetch Node Names:** Used `kubectl get nodes` to retrieve specific instance names managed by the Autopilot cluster.
5. **List SQL Instances:** Ran `gcloud sql instances list` to identify database instances.
