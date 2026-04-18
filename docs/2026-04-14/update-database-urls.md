# Update Database and Schema Names for Production Services

Date: 2026-04-14
Task: Update `k8s/overlays/prod/kustomization.yaml` for all 5 services with correct Database URLs, Schema names, and Timezone settings.

## Summary of Changes

Updated the `configMapGenerator` in the following services (Paths are now internal to each repository):

1. **panda-ev-csms-system-admin**
   - File: `panda-ev-csms-system-admin/k8s/overlays/prod/kustomization.yaml`
   - `DATABASE_URL`: "postgresql://panda_admin_user:PASSWORD@127.0.0.1:5432/panda_ev_system?schema=panda_ev_system&options=-c%20timezone%3DAsia%2FVientiane"

2. **panda-ev-client-mobile**
   - File: `panda-ev-client-mobile/k8s/overlays/prod/kustomization.yaml`
   - `DATABASE_URL`: "postgresql://panda_mobile_user:PASSWORD@127.0.0.1:5432/panda_ev_mobile?schema=panda_ev_core&options=-c%20timezone%3DAsia%2FVientiane"
   - `DATABASE_REPLICA_URL`: "postgresql://panda_mobile_reader:PASSWORD@127.0.0.1:5433/panda_ev_mobile?schema=panda_ev_core&options=-c%20timezone%3DAsia%2FVientiane"

3. **panda-ocpp-api**
   - File: `panda-ev-ocpp/k8s/overlays/prod/kustomization.yaml`
   - `DATABASE_URL`: "postgresql://panda_ocpp_user:PASSWORD@127.0.0.1:5432/panda_ev_ocpp?schema=panda_ev_ocpp&options=-c%20timezone%3DAsia%2FVientiane"
   - `DATABASE_REPLICA_URL`: "postgresql://panda_ocpp_reader:PASSWORD@127.0.0.1:5433/panda_ev_ocpp?schema=panda_ev_ocpp&options=-c%20timezone%3DAsia%2FVientiane"

4. **panda-ev-gateway-services**
   - File: `panda-ev-gateway-services/k8s/overlays/prod/kustomization.yaml`
   - `DATABASE_URL`: "postgresql://panda_gateway_user:PASSWORD@127.0.0.1:5432/panda_ev_core?schema=panda_ev_gateway&options=-c%20timezone%3DAsia%2FVientiane"

5. **panda-ev-notification**
   - File: `panda-ev-notification/k8s/overlays/prod/kustomization.yaml`
   - `DATABASE_URL`: "postgresql://panda_noti_user:PASSWORD@127.0.0.1:5432/panda_ev_core?schema=panda_ev_noti&options=-c%20timezone%3DAsia%2FVientiane"

## Verification
- Verified all file paths and ensured they exist within the service repositories.
- Included `&options=-c%20timezone%3DAsia%2FVientiane` to ensure the application uses the correct local time.
- Verified all JSON patches in `kustomization.yaml` were preserved.
- PASSWORD remains as a placeholder for the user to update in their Kubernetes Secrets.

---

## ⚠️ Important Note: Database Instance Timezone
Updating the connection string ensures the **Application** uses the correct timezone. However, you must also update the **Cloud SQL Instance** default timezone using `gcloud` flags.

Detailed instructions for instance-level patching can be found here:
[Step 11: Cloud SQL Password Setup & Database Initialization (Section 0)](2026-04-14-step-11-db-password-setup.md)
