✦ I have prepared the commands for the two options you requested for phonpasitbigbounkham6622@gmail.com in
  the pandaev project.

  Option 1: Full Admin Access
  This grants full control over the project, including managing users and billing.

    gcloud projects add-iam-policy-binding pandaev \
        --member="user:kothsada@gmail.com" \
        --role="roles/owner"

  ---

  Option 2: Restricted Developer Access
  This grants specific access to GKE (including port-forward), Cloud SQL (for proxy), and Monitoring
  dashboards.

  Run these 3 commands:

# 1. GKE Developer (Required for kubectl port-forward)
    gcloud projects add-iam-policy-binding pandaev \
        --member="user:phonpasitbigbounkham6622@gmail.com" \
        --role="roles/container.developer"

# 2. Cloud SQL Client (Required to use cloud-sql-proxy)
    gcloud projects add-iam-policy-binding pandaev \
        --member="user:phonpasitbigbounkham6622@gmail.com" \
        --role="roles/cloudsql.client"
   
# 3. Monitoring Viewer (To see logs and dashboards)
    gcloud projects add-iam-policy-binding pandaev \
        --member="user:phonpasitbigbounkham6622@gmail.com" \
        --role="roles/monitoring.viewer"

  I have updated your documentation in docs/20260418-gcp-iam-team-setup.md to include these specific options.

---

## ເພີ່ມ Developer ໃໝ່ 2 ຄົນ (2026-04-19)

### taphon2002@gmail.com

```bash
# 1. GKE Developer
gcloud projects add-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/container.developer"

# 2. Cloud SQL Client
gcloud projects add-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/cloudsql.client"

# 3. Monitoring Viewer
gcloud projects add-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/monitoring.viewer"
```

---

### tontakarn.phachansitthi46@gmail.com

```bash
# 1. GKE Developer
gcloud projects add-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/container.developer"

# 2. Cloud SQL Client
gcloud projects add-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/cloudsql.client"

# 3. Monitoring Viewer
gcloud projects add-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/monitoring.viewer"
```

---

### ກວດສອບສິດທິ (Verify):

```bash
gcloud projects get-iam-policy pandaev \
    --flatten="bindings[].members" \
    --filter="bindings.members:taphon2002@gmail.com OR bindings.members:tontakarn.phachansitthi46@gmail.com" \
    --format="table(bindings.role, bindings.members)"
```

---

## ການລຶບ User ອອກ (Remove IAM Bindings)

> ໃຊ້ `remove-iam-policy-binding` ແທນ `add-iam-policy-binding` — ຕ້ອງລຶບທີລະ role

### ຮູບແບບຄຳສັ່ງ (Template):

```bash
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:EMAIL" \
    --role="roles/ROLE_NAME"
```

---

### ລຶບ taphon2002@gmail.com:

```bash
# 1. ລຶບ GKE Developer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/container.developer"

# 2. ລຶບ Cloud SQL Client
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/cloudsql.client"

# 3. ລຶບ Monitoring Viewer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:taphon2002@gmail.com" \
    --role="roles/monitoring.viewer"
```

---

### ລຶບ tontakarn.phachansitthi46@gmail.com:

```bash
# 1. ລຶບ GKE Developer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/container.developer"

# 2. ລຶບ Cloud SQL Client
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/cloudsql.client"

# 3. ລຶບ Monitoring Viewer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:tontakarn.phachansitthi46@gmail.com" \
    --role="roles/monitoring.viewer"
```

---

### ລຶບ phonpasitbigbounkham6622@gmail.com:

```bash
# 1. ລຶບ GKE Developer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:phonpasitbigbounkham6622@gmail.com" \
    --role="roles/container.developer"

# 2. ລຶບ Cloud SQL Client
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:phonpasitbigbounkham6622@gmail.com" \
    --role="roles/cloudsql.client"

# 3. ລຶບ Monitoring Viewer
gcloud projects remove-iam-policy-binding pandaev \
    --member="user:phonpasitbigbounkham6622@gmail.com" \
    --role="roles/monitoring.viewer"
```

---

### ກວດສອບຫຼັງລຶບ (Verify after remove):

```bash
# ກວດວ່າ user ຍັງມີສິດຢູ່ ຫຼື ບໍ່
gcloud projects get-iam-policy pandaev \
    --flatten="bindings[].members" \
    --filter="bindings.members:EMAIL" \
    --format="table(bindings.role, bindings.members)"
```
