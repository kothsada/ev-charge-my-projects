# GCP IP Whitelist for LTC SMS Integration

**Date:** Friday, April 17, 2026
**Project:** Panda EV (pandaev)
**Service:** panda-ev-notification

## Summary
To enable SMS functionality via the LTC (Laotel) SMS API, the outbound IP address of the Panda EV GKE cluster must be whitelisted on the LTC side.

## Identified IP Addresses

### 1. Cloud NAT IP (Outbound Traffic)
This is the **primary IP** that needs to be whitelisted at LTC. All requests from the `panda-ev-notification` service (and other services in the private cluster) to external APIs will appear to come from this address.

*   **IP Address:** `34.126.166.249`
*   **Name:** `panda-ev-nat-ip`
*   **Purpose:** Outbound connectivity for private GKE nodes.

### 2. Ingress Static IP (Inbound Traffic)
This is the entry point for the Web APIs and is associated with the `panda-api-ip` resource. It is used by the Mobile App and Admin Dashboard to reach the services.

*   **IP Address:** `34.8.243.174`
*   **Name:** `panda-api-ip`
*   **Purpose:** Inbound traffic for `admin-api.pandaev.cc`, `api.pandaev.cc`, and `gateway-api.pandaev.cc`.

## Step-by-Step Whitelisting Process

1.  **Identify the IP:** Confirm that `34.126.166.249` is the active NAT IP in the `asia-southeast1` region for the `pandaev` project.
2.  **Contact LTC:** Provide the IP `34.126.166.249` to the LTC technical team for whitelisting.
3.  **Verification:** Once whitelisted, test the SMS delivery using the `/api/notification/v1/sms/send` endpoint in the Notification Service.

## Technical Context
The Panda EV production cluster is a private GKE cluster. Services running inside the cluster do not have individual public IP addresses. Instead, they share a common outbound gateway provided by **Cloud NAT**, which maps internal traffic to the reserved static IP `34.126.166.249`.
