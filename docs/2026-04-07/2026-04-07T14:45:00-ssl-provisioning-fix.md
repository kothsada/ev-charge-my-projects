# GKE Managed SSL Certificate Provisioning Fix - 2026-04-07

## Issue Summary
Google Managed Certificate (`panda-ev-certs`) was stuck in `Provisioning` with `FailedNotVisible` for all domains, even though DNS resolution for all domains pointed correctly to the Ingress static IP (`34.8.243.174`).

## Diagnosis
1.  **Ingress Sync Failure:** `kubectl describe ingress panda-ev-ingress -n panda-ev` revealed a `Warning: Translate` message: `invalid ingress spec: could not find service "panda-ev/panda-notification-api-service"`.
2.  **Missing Service:** The `panda-notification-api-service` was not found in the `panda-ev` namespace.
3.  **Missing Docker Image:** After manually deploying the missing service using `panda-ev-notification/k8s/deployment.yaml`, the pods remained in `ImagePullBackOff`.
4.  **Artifact Registry Verification:** `gcloud artifacts docker images list` confirmed that the image `asia-southeast1-docker.pkg.dev/pandaev/panda-ev-repo/panda-notification-api` does NOT exist in the repository.

## Actions Taken
To unblock SSL provisioning for the other three functional domains, the following steps were performed:

1.  **Modified `managed-cert.yaml`:**
    *   Temporarily removed `notification-api.pandaev.cc` from the `spec.domains` list.
2.  **Modified `panda-ev-ingress.yaml`:**
    *   Temporarily removed the `notification-api.pandaev.cc` host rule and its backend service association.
3.  **Applied Configuration Updates:**
    *   Ran `kubectl apply -f gcloud-config/google-ssl-and-loadbalance-config/managed-cert.yaml`
    *   Ran `kubectl apply -f gcloud-config/google-ssl-and-loadbalance-config/panda-ev-ingress.yaml`
4.  **Cleaned Up Failing Resources:**
    *   Ran `kubectl delete -f panda-ev-notification/k8s/deployment.yaml -n panda-ev` to prevent further Ingress translation errors until the image is ready.

## Results
*   **Ingress Sync Success:** The Ingress controller successfully updated the Google Cloud Load Balancer (`UrlMap updated`).
*   **Certificate Status Update:** The `ManagedCertificate` status for the remaining three domains transitioned from `FailedNotVisible` to `Provisioning`.
*   **Next Steps:** Google's Certificate Authority will now be able to verify the domains and issue the SSL certificate (expected within 10-20 minutes).

## Next Steps for Recovery
Once the `panda-notification-api` image is built and pushed to the Artifact Registry:
1.  Re-deploy the notification service: `kubectl apply -f panda-ev-notification/k8s/deployment.yaml -n panda-ev`.
2.  Add `notification-api.pandaev.cc` back to `managed-cert.yaml`.
3.  Add the `notification-api.pandaev.cc` host rule back to `panda-ev-ingress.yaml`.
4.  Apply both YAML files again.
