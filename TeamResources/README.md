# TeamResources

Rendez-vous ຂອງ `.env` + `keys/` ສຳລັບແຕ່ລະ Backend service, ໃຫ້ທີມເອົາໄປວາງໃນ local ຫລັງຈາກ clone ຈາກ GitHub.

**ຫ້າມ commit ໂຟນເດີນີ້ຂຶ້ນ GitHub** — ໄຟລ໌ທັງໝົດຢູ່ໃນນີ້ຖືກ `.gitignore` (pattern `**/.env`, `**/keys/`, `*.pem`) ຄຸ້ມຄອງຢູ່ແລ້ວ (verified ດ້ວຍ `git check-ignore`) ແຕ່ຢ່າອັບໂຫລດຂຶ້ນບ່ອນອື່ນ (Slack public channel, ແອັບ share ທົ່ວໄປ) — ສົ່ງຜ່ານຊ່ອງທາງທີ່ປອດໄພ (1Password, encrypted zip, private DM).

## ວິທີໃຊ້ (ຕໍ່ 1 service)

```bash
# ຫລັງ clone repo ແລ້ວ, ຢູ່ root ຂອງ repo:
cp TeamResources/<service-name>/.env <service-name>/.env
cp -R TeamResources/<service-name>/keys <service-name>/keys
```

ຕົວຢ່າງ (Mobile API):
```bash
cp TeamResources/panda-ev-client-mobile/.env panda-ev-client-mobile/.env
cp -R TeamResources/panda-ev-client-mobile/keys panda-ev-client-mobile/keys
```

ເຮັດຊ້ຳແບບນີ້ໃຫ້ຄົບ 5 services (ຫລື 6 ຖ້າຕ້ອງການ simulator).

## ລຳດັບການ run (ຕ້ອງມີ Local Infra ກ່ອນ)

ທຸກ service ຊີ້ໄປ `localhost` — DB/Redis/RabbitMQ ຕ້ອງແລ່ນຢູ່ local ກ່ອນ:
- PostgreSQL (localhost:5432, user `postgresuser`)
- Redis (localhost:6379)
- RabbitMQ (localhost:5672)

ມີ `docker-compose.yml` ຢູ່ໃນ `panda-ev-csms-system-admin/` ເທົ່ານັ້ນ — ໃຊ້ອັນນັ້ນຂຶ້ນ infra ກ່ອນ (`docker compose up -d`), ຫລືຖ້າມີ Postgres/Redis/RabbitMQ ຂອງຕົນເອງແລ້ວ (ຜ່ານ Homebrew/local install) ກໍ່ໃຊ້ໄດ້ ຂໍໃຫ້ DB name/schema ກົງກັບໃນ `.env` ຂອງແຕ່ລະ service (`panda_ev_ocpp`, `panda_ev_system`, `panda_ev_mobile`, `panda_ev_core` — ອ້າງອີງ CLAUDE.md → Database Isolation).

ຫລັງ infra ພ້ອມ, ຕໍ່ 1 service:
```bash
npx prisma generate
npx prisma migrate deploy   # ຫລື db seed ຖ້າ DB ຫວ່າງ
npm run start:dev
```

**ລຳດັບແນະນຳ start**: Admin (4000) → Mobile (4001) → OCPP (4002) → Gateway (4004) → Notification (5001), ເພາະ RS256 service-to-service auth ຕ້ອງການ trusted peer public keys ຢູ່ຄົບ (ຢູ່ໃນ `keys/` ແລ້ວ) ແຕ່ RabbitMQ ຈະ soft-fail ຖ້າ service ອື່ນຍັງບໍ່ຂຶ້ນ — ບໍ່ block boot.

## ສະຫລຸບແຕ່ລະ Service

| Service | ໄຟລ໌ | ໝາຍເຫດພິເສດ |
|---|---|---|
| `panda-ev-ocpp/` | `.env` + `keys/` (ocpp.pem + peer pubs) | JWT_SECRET ເປັນ local dev value, ບໍ່ໄດ້ໃຊ້ user JWT (OCPP ບໍ່ອອກ user token) |
| `panda-ev-csms-system-admin/` | `.env` + `keys/` (admin.pem + peer pubs) | ມີ `GCS_BUCKET_NAME`/`GCS_PROJECT_ID` — upload ຮູບຕ້ອງມີ GCP credentials ຕ່າງຫາກ (ບໍ່ຢູ່ໃນນີ້, ຖາມ owner ຖ້າຕ້ອງການທົດສອບ upload) |
| `panda-ev-client-mobile/` | `.env` + `keys/` (mobile.pem + peer pubs) | SMTP creds ຢູ່ໃນ `.env` ແລ້ວ (ສຳລັບ email OTP/reset password) |
| `panda-ev-notification/` | `.env` + `keys/` (notification.pem + peer pubs + **Firebase Admin SDK json**) | ຖ້າບໍ່ຕ້ອງການທົດສອບ FCM push ແທ້, ບໍ່ຕ້ອງກັງວົນ; `LTC_SMS_API_KEY` ຖ້າຫວ່າງ = dry-run mode (ບໍ່ສົ່ງ SMS ແທ້, ປອດໄພສຳລັບ dev) |
| `panda-ev-gateway-services/` | `.env` + `keys/` (gateway.pem + peer pubs + **bcel-merchant.pem** + **laoqr-merchant.pem**) | ຄ່າ payment gateway ແທ້ (BCEL/LaoQR) — ລະວັງ, ນີ້ແມ່ນ credentials ຈິງ ບໍ່ແມ່ນ sandbox. ໃຊ້ `BCEL_MODE` ໃນ `.env` ເພື່ອສະຫລັບ TEST/PRODUCTION |
| `ocpp-virtual-charge-point/` | `.env` ເທົ່ານັ້ນ (ບໍ່ມີ secrets) | Optional — simulator ສຳລັບທົດສອບ OCPP flow ໂດຍບໍ່ຕ້ອງມີເຄື່ອງສາກແທ້ |

## ຮູ້ໄວ້ກ່ອນ (Known gaps)

- `QR_SIGNING_SECRET` ບໍ່ໄດ້ set ຢູ່ໃນ `.env` ຂອງ Admin/Mobile ຕອນນີ້ — ຖ້າຈະທົດສອບ QR charging flow, ຕ້ອງ `export QR_SIGNING_SECRET=$(openssl rand -hex 32)` ດຽວກັນທັງ 2 service ເອງ (ຄ່າຕ້ອງກົງກັນ, ອ້າງອີງ CLAUDE.md → K8s secrets workflow)
- `panda-ev-csms-system-admin` ມີໄຟລ໌ `backup/.env.github`, `.env.local`, `.env.docker` ຢູ່ໃນ repo ເອງ — ອັນເຫລົ່ານັ້ນເປັນ snapshot ເກົ່າ, ບໍ່ໄດ້ເອົາເຂົ້າມາໃນນີ້, ໃຊ້ `.env` ຫລັກທີ່ໃຫ້ນີ້ເປັນ source of truth
- ຄ່າ DB/Redis/RabbitMQ ໃນທຸກ `.env` ຊີ້ໄປ localhost (local dev), **ບໍ່ແມ່ນ** production Cloud SQL — ປອດໄພສຳລັບ local run
