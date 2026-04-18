# Move Kustomize Configuration and Update Workflows

## Date: 2026-04-14

## Context
Move the Kustomize configuration from 'kubernetes/services/' back into each service's own repository folder and update their GitHub Actions workflows to use the new local paths.

## Services to process:
- panda-ev-client-mobile
- panda-ev-csms-system-admin
- panda-ev-gateway-services
- panda-ev-notification

## Steps
1. Create the 'k8s/base/' and 'k8s/overlays/{dev,prod}/' directory structure within each service folder.
2. Copy the corresponding Kustomize configuration files from 'kubernetes/services/<service-name>/' to the newly created 'k8s/' folder.
3. Update the '.github/workflows/deploy.yml' for each service:
   - Modify 'Set up Kustomize' step to keep the binary in the local directory (do not move it to /usr/local/bin).
   - Change the deployment directory from 'kubernetes/services/...' to 'k8s/overlays/${{ env.ENV_NAME }}'.
   - Update Kustomize commands to use the relative path '../../kustomize'.
4. Keep 'kubernetes/services/' folders as a backup until completion.
5. Verify the new structure and workflow changes.
