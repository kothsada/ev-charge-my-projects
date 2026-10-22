ພາຍໃນມີ 3 diagrams:

1. ການສາກປົກກະຕິ (Online Happy Path) — start→RemoteStartTransaction→StartTransaction→MeterValues loop→StopTransaction→ຄິດເງິນ+ໜັກໜ່ວງ ພ້ອມທຸກໄລຍະເວລາ (command timeout 15s, late-ack window 25s) ແລະ ການຈອງ lockedBalance ທີ່ເກີດຂຶ້ນທຸກ session (ບໍ່ແມ່ນສະເພາະ offline)
2. ສາກ Offline V2 — ຈາກຈຸດ WebSocket ຂາດ → grace 3 ນາທີ → STUCK_AWAITING_REPORT (24h) → 3 ທາງອອກ (delayed StopTransaction / auto-free ຫຼັງ 24h / Team Kill Session) + cron backstop ອື່ນໆ (8h stuck sweep, 15-min orphan sweep, 48h lock reaper) — ໝາຍຊັດເຈນວ່າຈຸດໃດ ✅ CEO ຕັດສິນໃຈແລ້ວ, ຈຸດໃດ 🧑‍💼 Team ຕ້ອງຕັດສິນໃຈເອງທຸກຄັ້ງ, ຈຸດໃດ 🤖 ອັດຕະໂນມັດ
3. Dashboard Resolution — Session ຄ້າງ — ກໍລະນີສາກຮອບ 2 ໃນຂະນະຮອບ 1 ຄ້າງ: ຄອນເນັກເຕີ້ດຽວກັນ→ບລັອກອັດຕະໂນມັດ (409), ຄອນເນັກເຕີ້ຄົນລະຕູ້→ອະນຸຍາດແຕ່ locked_balance ຊ້ອນກັນ, ພ້ອມສິ່ງທີ່ Dashboard ຕ້ອງສະແດງໃຫ້ Team ເຫັນ

ວິທີແກ້ໄຂ/ຄອມເມັນຕໍ່: ເປີດ link ຂ້າງເທິງ (Eraser ຈະໃຫ້ login/signup ຄັ້ງທຳອິດ ຖ້າຍັງບໍ່ໄດ້ login), ຄລິກໃສ່ diagram ໃດອັນໜຶ່ງ ແລ້ວ:
- ແກ້ໄຂ node/ຂໍ້ຄວາມເອງ: double-click ໃສ່ arrow ຫຼື note ໃນ canvas, ພິມແກ້ໄດ້ໂດຍກົງ (Eraser ເປັນ editor ແບບ diagram-as-code, ດ້ານຂວາມີ code panel ໃຫ້ແກ້ໄດ້ຄືກັນ)
- ບອກຂ້ອຍໃຫ້ແກ້: ພຽງແຕ່ບອກຂ້ອຍໃນແຊັດນີ້ ວ່າຢາກປ່ຽນຫຍັງ (ເຊັ່ນ "ເພີ່ມ step ນີ້ໃສ່ diagram 2" ຫຼື "ປ່ຽນ 48h ເປັນ 72h") ຂ້ອຍຈະ update ໄດ້ໂດຍກົງຜ່ານ Eraser API — ບໍ່ຕ້ອງ export/import ໃໝ່