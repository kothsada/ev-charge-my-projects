# Step-by-Step Guide: Identification of Notification Service API URL

This document provides the details for the Notification Service API URLs in both production and development environments.

## Date: 2026-04-20

### Step 1: Internal Microservice URL (Kubernetes)
The Notification Service runs as a separate microservice within the Kubernetes cluster.

- **Service Name:** `panda-notification-api-service`
- **Namespace:** `panda-ev-prod`
- **Internal Port:** `80` (mapped to container port `4003`)
- **Global Prefix:** `/api/notification`
- **Internal FQDN:** `http://panda-notification-api-service.panda-ev-prod.svc.cluster.local/api/notification`

### Step 2: External Admin API URL
The CSMS Admin System acts as a gateway for managing notifications. The frontend communicates with the Notification Service via the Admin API.

- **Host:** `admin-api.pandaev.cc`
- **API Path:** `/api/admin/v1/notifications`
- **Full URL:** `https://admin-api.pandaev.cc/api/admin/v1/notifications`

### Step 3: Communication Flow
1. **Admin UI** sends a request to `admin-api.pandaev.cc/api/admin/v1/notifications`.
2. **Admin Service** (CSMS) processes the request and publishes a message to **RabbitMQ** (Queue: `PANDA_EV_NOTIFICATIONS`).
3. **Notification Service** consumes the message from RabbitMQ and interacts with **FCM (Firebase Cloud Messaging)** or **SMS providers** to deliver the message.

### Step 4: Documentation (Swagger)
- **Public Admin Docs:** `https://admin-api.pandaev.cc/api/admin/v1/docs`
- **Internal Service Docs:** Accessible via port-forwarding at `http://localhost:5001/api/notification/docs` (if enabled).

---
*Note: Direct external access to the Notification Service microservice is restricted. Use the CSMS Admin API for all administrative notification tasks.*
