# TeamDeployKubeDev

ຮວມ k8s manifests (`base` + `overlays/dev`) + `create-secret.sh` ຂອງແຕ່ລະ Backend service, ສຳລັບທີມທີ່ຕ້ອງການ deploy ຂຶ້ນ **Dev Cluster** (namespace `panda-ev-dev`) ໂດຍກົງ (ບໍ່ຜ່ານ GitHub Actions CI).

**ຫ້າມ commit ໂຟນເດີນີ້ຂຶ້ນ GitHub** — `create-secret.sh` ຂອງແຕ່ລະ service ມີ DB password / RabbitMQ password ຝັງຢູ່ໃນສະຄຣິບໂດຍກົງ (ບໍ່ແມ່ນອ້າງອີງໄຟລ໌ນອກແບບ TeamResources). ໄຟລ໌ `create-secret.sh` ຖືກ `.gitignore` (pattern `**/create-secret.sh`) ຄຸ້ມຄອງຢູ່ແລ້ວ (verified ດ້ວຍ `git check-ignore`), ແຕ່ໄຟລ໌ k8s manifests (`*.yaml`) ບໍ່ໄດ້ຖືກ ignore — ຢ່າ `git add` ໂຟນເດີນີ້ທັງໝົດ, ແລະຢ່າອັບໂຫລດຂຶ້ນບ່ອນອື່ນນອກຈາກຊ່ອງທາງປອດໄພ (1Password, encrypted zip, private DM).

## ໂຄງສ້າງ (ຕໍ່ 1 service)

```
<service-name>/
├── create-secret.sh              # ຝັງ DB/RabbitMQ password ແທ້ — sensitive
└── k8s/
    ├── base/                     # Deployment, Service, HPA, PDB, ServiceAccount, BackendConfig
    └── overlays/dev/
        └── kustomization.yaml    # namespace panda-ev-dev + patch/config ສະເພາະ dev
```

ຄົບ 5 services: `panda-ev-ocpp`, `panda-ev-csms-system-admin`, `panda-ev-client-mobile`, `panda-ev-gateway-services`, `panda-ev-notification`.

## ຂັ້ນຕອນ Deploy ຂຶ້ນ Dev Cluster (ຕໍ່ 1 service)

```bash
# 0. ຕ້ອງມີ RSA keys ກ່ອນ (ຖ້າຍັງບໍ່ໄດ້ generate) — ເບິ່ງ CLAUDE.md → K8s secrets workflow
cd <service-name> && ./generate-service-keys-local.sh   # ຫລືໃຊ້ keys/ ທີ່ມີຢູ່ແລ້ວໃນ TeamResources

# 1. ຢືນຢັນ kubectl context ຊີ້ໄປ Dev cluster ກ່ອນສະເໝີ
kubectl config current-context

# 2. Push secrets (namespace = panda-ev-dev)
cd <service-name>
./create-secret.sh panda-ev-dev

# 3. Apply k8s manifests ຜ່ານ kustomize overlay
kubectl apply -k k8s/overlays/dev
```

**ລຳດັບແນະນຳ deploy**: Admin → Mobile → OCPP → Gateway → Notification (ຄືກັນກັບ local run — RS256 service-to-service auth ຕ້ອງການ trusted peer public keys).

QR_SIGNING_SECRET ຕ້ອງ set ດ້ວຍຄ່າດຽວກັນທັງ Admin + Mobile ຢູ່ໃນ Dev namespace ຄືກັນ — ອ້າງອີງ CLAUDE.md → K8s secrets workflow.

## ຮູ້ໄວ້ກ່ອນ (Known gaps)

- ໂຟນເດີນີ້ບໍ່ມີ `k8s/overlays/prod/` — ສະເພາະ Dev cluster ເທົ່ານັ້ນ. ຢ່າໃຊ້ script ພາຍໃນນີ້ຂຶ້ນ prod namespace.
- `create-secret.sh` ບາງ service ຍັງມີຊື່ secret ຝັງຄຳວ່າ `-prod-` (ຕົວຢ່າງ: `panda-rabbitmq-prod-secrets` ໃນ `panda-ev-ocpp`) — ນີ້ແມ່ນຊື່ secret object ພາຍໃນ K8s ເອງ (legacy naming), ບໍ່ໄດ້ໝາຍຄວາມວ່າມັນຈະໄປສ້າງໃນ prod namespace — script ຍັງຮັບ namespace ເປັນ argument ປົກກະຕິ, ແຕ່ໃຫ້ກວດ `NAMESPACE=$1` ໃຫ້ແນ່ໃຈວ່າໃສ່ `panda-ev-dev` ທຸກຄັ້ງ.
- Docker image build ບໍ່ໄດ້ລວມຢູ່ໃນນີ້ (Dockerfile/docker-entrypoint.sh ຍັງຢູ່ໃນແຕ່ລະ service repo ຫລັກ) — ຖ້າ CI (`.github/workflows/deploy.yml`) ບໍ່ໄດ້ build/push image ໃຫ້ອັດຕະໂນມັດ, ຕ້ອງ build+push ເອງກ່ອນ `kubectl apply -k`.
- `k8s/overlays/dev/kustomization.yaml` ຊີ້ໄປ Redis/Gateway ຜ່ານ `*.panda-ev-dev.svc.cluster.local` — infra (Redis, RabbitMQ) ຕ້ອງມີຢູ່ໃນ namespace `panda-ev-dev` ຢູ່ແລ້ວກ່ອນ deploy service ພວກນີ້.
