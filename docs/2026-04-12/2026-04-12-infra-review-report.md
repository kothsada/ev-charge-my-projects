# Infrastructure Review Report - 2026-04-12

## 🎯 ບົດສະຫຼຸບການກວດສອບ (Executive Summary)
ຈາກການກວດສອບ Services ທັງໝົດ (Admin, Mobile, OCPP, Noti, Gateway), ພົບວ່າລະບົບປັດຈຸບັນຖືກຕັ້ງຄ່າແບບ **Single Environment** (ສ່ວນໃຫຍ່ແມ່ນ Development). ເພື່ອຈະກ້າວໄປຫາ Production, ຈຳເປັນຕ້ອງມີການແຍກ Environments ໃຫ້ຊັດເຈນໃນລະດັບ Infrastructure ແລະ Code.

## 🚩 ສິ່ງທີ່ຕ້ອງປັບປຸງ (Gaps Found)

### 1. Kubernetes Separation
- **ປັດຈຸບັນ:** ທຸກຢ່າງຢູ່ໃນ Namespace `panda-ev`.
- **ບັນຫາ:** ບໍ່ມີການກັ້ນ Resource ລະຫວ່າງ Dev ແລະ Prod. ການ Test ໃນ Dev ອາດຈະໄປດຶງ Resource ຂອງ Prod ໄດ້.
- **ວິທີແກ້:** ສ້າງ Namespace `panda-ev-dev` ແລະ `panda-ev-prod`.

### 2. CI/CD (GitHub Actions)
- **ປັດຈຸບັນ:** Workflow ທຸກຕົວ Trigger ຈາກ `main` branch ບ່ອນດຽວ.
- **ບັນຫາ:** ບໍ່ມີ Flow ສຳລັບການ Test ກ່ອນ Release ແທ້.
- **ວິທີແກ້:** ໃຊ້ Branching Strategy (Develop -> main) ພ້ອມແຍກ Deployment Environment ໃນ GitHub.

### 3. Config Management
- **ປັດຈຸບັນ:** `deployment.yaml` ມີການ Hardcode ຄ່າຕ່າງໆ (ເຊັ່ນ: `NODE_ENV: "development"`).
- **ບັນຫາ:** ຕ້ອງໄດ້ແປງໄຟລ໌ທຸກຄັ້ງທີ່ຢາກ Deploy ໄປ environment ທີ່ຕ່າງກັນ.
- **ວິທີແກ້:** ໃຊ້ **Kustomize** ຫຼື **Helm** ເພື່ອຈັດການ Overlays ຂອງແຕ່ລະ Env.

### 4. Database Instances
- **ປັດຈຸບັນ:** ໃຊ້ Instance ດຽວຕໍ່ 1 Service.
- **ບັນຫາ:** ໃນ Production ຕ້ອງການ High Availability (HA) ແລະ Read Replica ເຊິ່ງ Dev ບໍ່ຈຳເປັນຕ້ອງມີ (ເພື່ອປະຢັດ Cost).
- **ວິທີແກ້:** ສ້າງ Instance ໃໝ່ສຳລັບ Prod ໂດຍເປີດ HA ແລະ ແຍກຈາກ Dev Instance ຢ່າງເດັດຂາດ.

## 🛠️ ແຜນການດຳເນີນງານ (Roadmap)
1. **Infrastructure Provisioning:** ສ້າງ Resources ຊຸດໃໝ່ສຳລັບ Prod (SQL, Memorystore).
2. **K8s Setup:** ສ້າງ `panda-ev-prod` namespace ແລະ ຕັ້ງຄ່າ RBAC.
3. **Manifest Refactoring:** ປ່ຽນ `k8s/` ໃຫ້ຮອງຮັບ Kustomize (base + overlays/dev + overlays/prod).
4. **CI/CD Update:** ປັບປຸງ `.github/workflows/deploy.yml` ໃຫ້ແຍກ logic ຕາມ branch.
5. **Secret Migration:** ຍ້າຍ Secret ໄປຈັດເກັບໃນ GCP Secret Manager ເພື່ອຄວາມປອດໄພ.

---
ລາຍງານນີ້ສ້າງຂຶ້ນເພື່ອເປັນແນວທາງໃນການ Upgrade ລະບົບ Panda EV Hub ໄປຫາ Production ຢ່າງສົມບູນ.
