# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a **firmware deployment package** for Panda EV DC fast chargers running on embedded Linux (ARM). It contains pre-compiled binaries and shell scripts — there is no source code here. The repo root (`fireware-charger/`) holds two charger variants:

| Directory | Standard | Connector | Version |
|---|---|---|---|
| `ccs2-老挝欧标-ccs2-ocpp4.90.204/pkg/` | EU/Laos CCS2 | CCS2 (Type 2 combo) | 4.90.204 |
| `gbt-老挝国标-gbt-ocpp4.9.204/pkg/` | CN/Laos GB/T | GB/T | 4.9.204 |

Both variants share identical file names and deployment structure. The binaries differ only in connector-protocol handling.

## Process Architecture

The charger runs these concurrent processes on the embedded device (deployed to `/opt/QtMc/`):

| Binary | Role | Started by |
|---|---|---|
| `QMC021` | **Main application** — charger HMI, session management, hardware control | `run.sh` |
| `QMS_OCPPJClient` | OCPP 1.6J WebSocket client — communicates with CSMS | `exRun.sh` (with watchdog loop) |
| `QMS_TieTaMqtt` | MQTT client for TieTa cloud platform | manual / systemd |
| `QMC_SysSettings` | System settings UI (Qt, requires `DISPLAY=:0.0`) | `run_setting.sh` |
| `QMC_IrCtl` | Infrared remote controller | — |
| `QMC_PLoader` | OTA package loader | — |
| `QCMSimulator` | Charger hardware simulator (for testing) | — |
| `DMA_DMan` | DMA device manager | — |
| `Watchdog` | System watchdog | — |

## Shell Scripts

| Script | Purpose |
|---|---|
| `run.sh` | Kill any existing `QMC021`, sleep 2s, `exec /opt/QtMc/QMC021` |
| `exRun.sh` | Start `QMS_OCPPJClient`, poll every 30s and restart if it dies |
| `run_setting.sh` | Set `DISPLAY=:0.0`, launch `onboard` + `QMC_SysSettings` |
| `devInit.sh` | Extract `pkg.tar.gz` update if present, wipe cache, reset touch panel config (`GT9110`), fix permissions on `/etc/QMC021/` |
| `4g_man.sh` | 4G modem watchdog — pings `139.224.41.205`, sends AT commands to EC200M module to reconnect; reboots device after 30 failed attempts |
| `install.sh` | Copy `cg_config.ini` from `/opt/QtMc/` → `/etc/QMC021/` |
| `pkg.sh` | Package `pkg/` contents: `tar -pcvf pkg.tar ./*` |

## Configuration — `cg_config.ini`

Live config lives on-device at `/etc/QMC021/cg_config.ini`. The file in this repo is the base template.

Key sections:

```ini
[mc_info]
client_username = ws://106.15.190.121:8080/steve/websocket/CentralSystemService/
# OCPP WebSocket URL — this is the chargeBoxIdentity prefix; charger appends mc_number
mc_number = 225000           # ChargeBox identity suffix
port = 6001                  # Local management port

[mc_sysconf]
Gunnum = 2                   # Number of connectors (guns)
Piletype = 1                 # 1=CCS2 (EU), 2=GB/T

[cm_set]
charger_type = 4             # DC fast charger
cg_module_number = 6         # Number of power modules
Outcur = 100                 # Max output current (A)
Outvol = 750                 # Max output voltage (V)
current_output_maximum = 250.0
voltage_output_maximum = 999.0
out_power_max = 1000         # Max power (kW)
meter_protocol = 2           # Electric meter protocol

[mc_ftp]
ftp_ip = 139.224.41.205      # OTA update FTP server
ftp_port = 12346

[ChargingStrategy]
ServiceCost0 = 30            # Service fee (LAK per kWh × 100 or flat — confirm with firmware docs)
```

**To update OCPP server URL**: edit `client_username` in `cg_config.ini`, push to device via FTP or SCP, then run `install.sh`.

## Deployment

### Packaging a firmware update

```bash
cd pkg/
./pkg.sh          # creates pkg.tar in the current directory
```

Then upload `pkg.tar` (or `pkg.tar.gz`) to the FTP server at `139.224.41.205:12346`. On next device boot, `devInit.sh` extracts it to `/opt/QtMc/`.

### Manual deploy to device

```bash
# SCP the whole pkg directory
scp -r pkg/* root@<device-ip>:/opt/QtMc/

# Apply config
ssh root@<device-ip> 'cd /opt/QtMc && ./install.sh'

# Restart main application
ssh root@<device-ip> 'cd /opt/QtMc && ./run.sh'

# Restart OCPP client
ssh root@<device-ip> 'pkill -f QMS_OCPPJClient && ./exRun.sh &'
```

Default credentials from config: `root` / `99117733`, charger admin / `88888888`.

### On-device file locations

| Purpose | Path |
|---|---|
| Binaries & scripts | `/opt/QtMc/` |
| Runtime config | `/etc/QMC021/cg_config.ini` |
| Touch panel config | `/etc/GT9110_R7_V00_PGA6_1024X600.cfg` |
| 4G state log | `/var/log/4g_state.log`, `/var/log/net_4g.log` |
| 4G device presence | `/var/log/4g_device` |
| OTA update trigger | `/opt/QtMc/pkg.tar.gz` (deleted after extraction) |
| Cache dir (wiped on boot) | `/opt/QtMc/Cache/` |

## CCS2 vs GB/T Differences

The two variant directories are structurally identical. Only the `QMC021` and `QMS_OCPPJClient` binaries differ (built with different connector protocol stacks). Config difference: `Piletype=1` for CCS2, `Piletype=2` for GB/T.

When deploying or comparing firmware versions, diff the binary sizes/dates rather than contents.

## OCPP Identity

The charger's OCPP ChargeBoxIdentity is `mc_number` from `[mc_info]` (e.g. `225000`). The full OCPP endpoint becomes:
```
ws://106.15.190.121:8080/steve/websocket/CentralSystemService/225000
```
This identity must match the charger registered in the CSMS (`panda-ev-ocpp` service).
