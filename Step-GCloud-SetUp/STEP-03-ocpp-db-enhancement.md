# Step 03: OCPP DB Enhancement (Critical) ⚡

## ຈຸດປະສົງ (Objective)
ເພື່ອປັບປຸງປະສິດທິພາບຂອງຖານຂໍ້ມູນ `panda_ev_ocpp` ໃຫ້ຮອງຮັບການຂຽນຂໍ້ມູນຈຳນວນມະຫາສານ (High-frequency writes) ຈາກ Chargers 60 ເຄື່ອງຂຶ້ນໄປ. ເນັ້ນການໃຊ້ Table Partitioning, Connection Pooling ຜ່ານ PgBouncer, ແລະ ວາງແຜນການຈັດເກັບຂໍ້ມູນໄລຍະຍາວ (Archiving).

## 1. Table Partitioning Strategy
ສຳລັບ Table ທີ່ມີຂໍ້ມູນເພີ່ມຂຶ້ນໄວທີ່ສຸດ (Write-heavy), ເຮົາຈະໃຊ້ **Declarative Partitioning** ຕາມໄລຍະເວລາ (By Month):

### Table: `ocpp_logs`
- **Partition Key:** `created_at` (TIMESTAMP)
- **Interval:** 1 ເດືອນຕໍ່ 1 Partition.
- **ຈຸດປະສົງ:** ເພື່ອໃຫ້ການ Query ຂໍ້ມູນ Log ຍ້ອນຫຼັງບໍ່ໄປກະທົບກັບ Performance ຂອງ Table ຫຼັກ ແລະ ຊ່ວຍໃຫ້ການລຶບຂໍ້ມູນເກົ່າ (Purge/Archive) ເຮັດໄດ້ໄວຂຶ້ນ.

### Table: `meter_values`
- **Partition Key:** `timestamp` (TIMESTAMP)
- **Interval:** 1 ເດືອນຕໍ່ 1 Partition.
- **ຈຸດປະສົງ:** ເນື່ອງຈາກ Meter Values ຖືກສົ່ງມາທຸກໆ 30-60 ວິນາທີຕໍ່ເຄື່ອງ, ຂໍ້ມູນຈະໃຫຍ່ໄວຫຼາຍ.

## 2. SQL Scripts (Production-Ready)

```sql
-- 1. ສ້າງ Table ocpp_logs ແບບ Partitioned
CREATE TABLE ocpp_logs (
    id SERIAL,
    charger_id VARCHAR(255) NOT NULL,
    action VARCHAR(100),
    message_type VARCHAR(50),
    payload JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at) -- Partition key ຕ້ອງເປັນສ່ວນໜຶ່ງຂອງ PK
) PARTITION BY RANGE (created_at);

-- 2. ຕົວຢ່າງການສ້າງ Partition ສຳລັບເດືອນ 04 ແລະ 05 ປີ 2026
CREATE TABLE ocpp_logs_y2026m04 PARTITION OF ocpp_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE ocpp_logs_y2026m05 PARTITION OF ocpp_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- 3. ສ້າງ Index ເພື່ອຊ່ວຍການ Search ຕາມ Charger ID
CREATE INDEX idx_ocpp_logs_charger_created ON ocpp_logs (charger_id, created_at DESC);

-- 4. ສ້າງ Index ສຳລັບ MeterValues (ສຳລັບ Dashboard)
CREATE INDEX idx_meter_values_charger_timestamp ON meter_values (charger_id, timestamp DESC);
```

## 3. PgBouncer Sidecar Configuration
ເພື່ອປ້ອງກັນ "Connection Exhaustion" ຈາກການທີ່ OCPP Service (Stateful) ເປີດ Connection ຫຼາຍເກີນໄປ, ເຮົາຈະໃຊ້ PgBouncer ເປັນ Proxy ຢູ່ຂ້າງ Pod.

### PgBouncer Config (ini):
```ini
[databases]
panda_ev_ocpp = host=127.0.0.1 port=5432 dbname=panda_ev_ocpp

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
```

### Kubernetes Sidecar YAML:
```yaml
- name: pgbouncer
  image: edoburu/pgbouncer:latest
  ports:
    - containerPort: 6432
  env:
    - name: DATABASE_URL
      value: "postgres://user:pass@127.0.0.1:5432/panda_ev_ocpp" # ຊີ້ຫາ Cloud SQL Proxy
  resources:
    limits:
      cpu: "200m"
      memory: "128Mi"
```

## 4. Archiving Strategy (> 90 ວັນ)
- **Retention Policy:** ເກັບຂໍ້ມູນໄວ້ໃນ Cloud SQL ພຽງແຕ່ 90 ວັນ (3 Partitions ຫຼ້າສຸດ).
- **Archiving Process:**
  1. ໃຊ້ CronJob ໃນ GKE ເພື່ອ Export Partition ທີ່ເກົ່າກວ່າ 90 ວັນ ອອກເປັນ CSV/SQL.
  2. ອັບໂຫຼດໄຟລ໌ໄປເກັບໄວ້ໃນ **Google Cloud Storage (Coldline)** ເພື່ອປະຢັດ Cost.
  3. ສັ່ງ `DROP TABLE <partition_name>` ເພື່ອຄືນພື້ນທີ່ໃຫ້ Cloud SQL.

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ວາງແຜນ Partitioning ສຳລັບ `ocpp_logs` ແລະ `meter_values` ຕາມເດືອນ.
- [x] ກຽມ SQL Scripts ສຳລັບການສ້າງ Table ແລະ Index.
- [x] ອອກແບບ Config ສຳລັບ PgBouncer Sidecar (Transaction Mode).
- [x] ກຳນົດກົດລະບຽບການເກັບຂໍ້ມູນ (Retention) ແລະ ການ Archive ໄປ Cloud Storage.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Transaction Mode:** ການໃຊ້ PgBouncer ໃນ `pool_mode = transaction` ອາດຈະບໍ່ຮອງຮັບ Prepared Statements ໃນບາງ Library ຂອງ NestJS (ເຊັ່ນ Prisma/TypeORM), ອາດຕ້ອງຕັ້ງຄ່າ `?pgbouncer=true` ໃນ Connection String.
- **Index Maintenance:** ການມີ Index ຫຼາຍເກີນໄປຈະເຮັດໃຫ້ການ Write ຊ້າລົງ. ໃຫ້ເກັບໄວ້ສະເພາະ Index ທີ່ຈຳເປັນແທ້ໆ (ເຊັ່ນ charger_id + timestamp).
- **Monitoring:** ຕ້ອງຕິດຕາມ "Transaction Lag" ຂອງ Read Replica ເພາະຖ້າມີການຂຽນຂໍ້ມູນ OCPP ຫຼາຍເກີນໄປ, Read Replica ອາດຈະ Sync ຂໍ້ມູນບໍ່ທັນ.

---
✅ Step 03 ສຳເລັດ — ບັນທຶກໃສ່ STEP-03-ocpp-db-enhancement.md
