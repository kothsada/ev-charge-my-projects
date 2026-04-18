# Backup ຂອງ Kubernetes Manifests ເກົ່າ (Legacy)

Folder ນີ້ຖືກສ້າງຂຶ້ນເພື່ອເກັບສຳຮອງໄຟລ໌ Kubernetes Manifests ແບບເກົ່າ (Static YAML) ທີ່ເຄີຍໃຊ້ກ່ອນທີ່ຈະປ່ຽນມາໃຊ້ລະບົບ **Kustomize**.

### **ເນື້ອໃນພາຍໃນ Folder ນີ້:**
- ໄຟລ໌ `deployment.yaml` ແລະ `.yaml` ອື່ນໆ ທີ່ເຄີຍຢູ່ທີ່ Root ຂອງ Folder `k8s/`.
- ໄຟລ໌ເຫຼົ່ານີ້ຖືກເກັບໄວ້ເພື່ອເປັນຂໍ້ມູນອ້າງອີງ ຫຼື Backup ເທົ່ານັ້ນ.

### **ຂໍ້ຄວນລະວັງ:**
**ຫ້າມໃຊ້ໄຟລ໌ໃນ Folder ນີ້** ເພື່ອ Deploy ໄປຫາສະພາບແວດລ້ອມໃໝ່ (Dev/Prod). ໃຫ້ໃຊ້ໂຄງສ້າງໃໝ່ທີ່ຢູ່ໃນ Folder `k8s/overlays/` ແທນ ເພາະມັນໄດ້ຖືກຕັ້ງຄ່າໃຫ້ຮອງຮັບ Master-Slave DB ແລະ ຄວາມປອດໄພທີ່ດີກວ່າແລ້ວ.

---
ວັນທີ Backup: 13 ເມສາ 2026
ໂດຍ: Gemini CLI
