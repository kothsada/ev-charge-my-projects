# Admin Charger Status WebSocket — Real-time Charger Status per Station

**Date:** 2026-04-24  
**Services affected:** `panda-ev-csms-system-admin`

---

## Problem

The admin web dashboard had no real-time push mechanism for charger/connector status changes per station. The existing `ChargerLiveStatusService` only served REST API snapshots (polling). When OCPP sends status events, `OcppStatusConsumerService` updated the database but never notified connected admin clients.

---

## Architecture Before This Change

```
Charger ──OCPP──► panda-ev-ocpp
                       │
           PANDA_EV_CHARGER_STATUS (RabbitMQ)
                       │
         OcppStatusConsumerService (Admin)
             └── UPDATE panda_ev_system DB only
                       │
         Admin Frontend polls REST API
         GET /chargers/dashboard  (every N seconds)
```

**Problem:** Frontend had to poll every few seconds. No instant updates.

---

## Solution Architecture

```
Charger ──OCPP──► panda-ev-ocpp
                       │
           PANDA_EV_CHARGER_STATUS (RabbitMQ)
                       │
         OcppStatusConsumerService (Admin)
             ├── UPDATE panda_ev_system DB
             └── ChargerStatusGateway.emit*()
                       │
            /charger-status namespace (Socket.IO)
            room: station:{stationId}
                       │
              Admin Frontend (WebSocket client)
              ← charger:status_updated
              ← connector:status_updated
```

---

## Files Changed

### `panda-ev-csms-system-admin`

| File | Change |
|---|---|
| `src/modules/station/charger-status.gateway.ts` | **New** — WebSocket gateway `/charger-status` namespace |
| `src/modules/station/services/ocpp-status-consumer.service.ts` | Inject `ChargerStatusGateway`; emit after every DB status update; added `stationId: true` to connector charger select |
| `src/modules/station/station.module.ts` | Import `AuthModule`; register `ChargerStatusGateway` in providers + exports |

---

## Commands Run

```bash
# Type-check after implementation (run from panda-ev-csms-system-admin/)
npx tsc --noEmit

# Fix found: select { id: true } was missing stationId: true in handleConnectorStatusChanged
# After fix: npx tsc --noEmit → no output (clean)
```

---

## Backend Implementation

### New File: `src/modules/station/charger-status.gateway.ts`

```typescript
import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/charger-status',
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' },
})
export class ChargerStatusGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChargerStatusGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const rawToken: string | undefined =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.headers.authorization as string | undefined);

    const token = rawToken?.startsWith('Bearer ')
      ? rawToken.slice(7)
      : rawToken;

    if (!token) {
      client.emit('auth_error', { message: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; type?: string }>(token);
      if (payload.type && payload.type !== 'access') {
        throw new Error('Not an access token');
      }
      this.logger.log(`WS /charger-status connected: socket=${client.id}, userId=${payload.sub}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      this.logger.warn(`WS /charger-status rejected (${msg}): socket=${client.id}`);
      client.emit('auth_error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WS /charger-status disconnected: socket=${client.id}`);
  }

  @SubscribeMessage('subscribe_station')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { stationId: string },
  ) {
    if (!data?.stationId) return;
    void client.join(`station:${data.stationId}`);
    this.logger.debug(`socket=${client.id} joined station:${data.stationId}`);
  }

  @SubscribeMessage('unsubscribe_station')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { stationId: string },
  ) {
    if (!data?.stationId) return;
    void client.leave(`station:${data.stationId}`);
    this.logger.debug(`socket=${client.id} left station:${data.stationId}`);
  }

  emitChargerStatus(stationId: string, payload: Record<string, unknown>) {
    this.server.to(`station:${stationId}`).emit('charger:status_updated', payload);
  }

  emitConnectorStatus(stationId: string, payload: Record<string, unknown>) {
    this.server.to(`station:${stationId}`).emit('connector:status_updated', payload);
  }
}
```

### Modified: `src/modules/station/services/ocpp-status-consumer.service.ts`

Key changes — added `ChargerStatusGateway` injection and emit calls after each DB update:

```typescript
// Added import
import { ChargerStatusGateway } from '../charger-status.gateway';

// Added to constructor
constructor(
  private readonly prisma: PrismaService,
  private readonly rabbitMQ: RabbitMQService,
  private readonly chargerStatusGateway: ChargerStatusGateway,  // ← NEW
) { ... }

// handleChargerBooted — after updateMany:
const charger = await this.prisma.charger.findFirst({
  where: { ocppIdentity: identity, deletedAt: null },
  select: { id: true, stationId: true },
});
if (charger) {
  this.chargerStatusGateway.emitChargerStatus(charger.stationId, {
    chargerId: charger.id,
    ocppIdentity: identity,
    stationId: charger.stationId,
    status: 'ONLINE',
    lastHeartbeat: now.toISOString(),
  });
}

// handleChargerStatusChanged — after updateMany:
const charger = await this.prisma.charger.findFirst({
  where: { ocppIdentity: identity, deletedAt: null },
  select: { id: true, stationId: true },
});
if (charger) {
  this.chargerStatusGateway.emitChargerStatus(charger.stationId, {
    chargerId: charger.id,
    ocppIdentity: identity,
    stationId: charger.stationId,
    status,
  });
}

// handleConnectorStatusChanged — select fix + emit after updateMany:
// BEFORE: select: { id: true }
// AFTER:  select: { id: true, stationId: true }   ← bug fix required for TypeScript
this.chargerStatusGateway.emitConnectorStatus(charger.stationId, {
  chargerId: charger.id,
  ocppIdentity: identity,
  connectorId,
  stationId: charger.stationId,
  status: prismaStatus,
});

// handleChargerOffline — after updateMany:
const charger = await this.prisma.charger.findFirst({
  where: { ocppIdentity: identity, deletedAt: null },
  select: { id: true, stationId: true },
});
if (charger) {
  this.chargerStatusGateway.emitChargerStatus(charger.stationId, {
    chargerId: charger.id,
    ocppIdentity: identity,
    stationId: charger.stationId,
    status: 'OFFLINE',
  });
}
```

### Modified: `src/modules/station/station.module.ts`

```typescript
import { ChargerStatusGateway } from './charger-status.gateway';
import { AuthModule } from '../auth/auth.module';  // provides JwtService

@Module({
  imports: [RabbitMQModule, AuthModule],  // ← added AuthModule
  providers: [
    // ... existing providers ...
    ChargerStatusGateway,  // ← new
  ],
  exports: [
    // ... existing exports ...
    ChargerStatusGateway,  // ← new
  ],
})
export class StationModule {}
```

---

## WebSocket API Reference

### Connect

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token: 'Bearer <admin-jwt>' },
});
// Note: namespace '/charger-status' is auto-handled by socket.io client
// when you pass it as the second argument to io():
const socket = io('http://localhost:4000/charger-status', {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token: 'Bearer <admin-jwt>' },
});
```

### Events to Send (Client → Server)

| Event | Payload | Description |
|---|---|---|
| `subscribe_station` | `{ stationId: string }` | Join room for this station's updates |
| `unsubscribe_station` | `{ stationId: string }` | Leave room when navigating away |

### Events Received (Server → Client)

| Event | Payload | Trigger |
|---|---|---|
| `charger:status_updated` | `{ chargerId, ocppIdentity, stationId, status, lastHeartbeat? }` | Boot / status change / offline |
| `connector:status_updated` | `{ chargerId, ocppIdentity, connectorId, stationId, status }` | OCPP StatusNotification |
| `auth_error` | `{ message }` | Invalid/missing JWT on connect |

### `charger:status_updated` — status values

| Value | Meaning |
|---|---|
| `ONLINE` | Charger booted or sent Available status |
| `OFFLINE` | Charger disconnected |

### `connector:status_updated` — status values (OCPP 1.6)

| Value | Meaning |
|---|---|
| `AVAILABLE` | Ready to charge |
| `PREPARING` | Cable plugged, waiting |
| `CHARGING` | Actively charging |
| `SUSPENDED_EVSE` | Charger paused the session |
| `SUSPENDED_EV` | Car paused the session |
| `FINISHING` | Session ending |
| `RESERVED` | Connector reserved |
| `UNAVAILABLE` | Out of service |
| `FAULTED` | Error / fault |

---

## Frontend Implementation

### Step 1 — Install socket.io-client

```bash
npm install socket.io-client
```

### Step 2 — Create WebSocket helper `src/lib/charger-status-socket.ts`

```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectChargerStatus(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(import.meta.env.VITE_API_URL + '/charger-status', {
    // Next.js: process.env.NEXT_PUBLIC_API_URL + '/charger-status'
    path: '/socket.io',
    transports: ['websocket'],
    autoConnect: true,
    auth: { token: `Bearer ${token}` },
  });

  socket.on('connect', () => {
    console.log('[ChargerWS] connected');
  });

  socket.on('auth_error', (err) => {
    console.error('[ChargerWS] auth error:', err);
    socket?.disconnect();
  });

  socket.on('disconnect', (reason) => {
    console.warn('[ChargerWS] disconnected:', reason);
  });

  return socket;
}

export function subscribeStation(stationId: string) {
  socket?.emit('subscribe_station', { stationId });
}

export function unsubscribeStation(stationId: string) {
  socket?.emit('unsubscribe_station', { stationId });
}

export function disconnectChargerStatus() {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
```

### Step 3 — Use in Station Detail Page (React)

```tsx
import { useEffect, useState } from 'react';
import {
  connectChargerStatus,
  subscribeStation,
  unsubscribeStation,
} from '@/lib/charger-status-socket';

type ChargerStatus = {
  chargerId: string;
  ocppIdentity: string;
  stationId: string;
  status: 'ONLINE' | 'OFFLINE';
  lastHeartbeat?: string;
};

type ConnectorStatus = {
  chargerId: string;
  ocppIdentity: string;
  connectorId: number;
  stationId: string;
  status: string;
};

export function StationDetailPage({ stationId }: { stationId: string }) {
  const [chargerStatuses, setChargerStatuses] = useState<Record<string, ChargerStatus>>({});
  const [connectorStatuses, setConnectorStatuses] = useState<Record<string, ConnectorStatus>>({});

  useEffect(() => {
    const token = localStorage.getItem('access_token') ?? '';
    const socket = connectChargerStatus(token);

    const joinRoom = () => subscribeStation(stationId);

    socket.on('connect', joinRoom);
    if (socket.connected) joinRoom();

    socket.on('charger:status_updated', (data: ChargerStatus) => {
      setChargerStatuses((prev) => ({ ...prev, [data.chargerId]: data }));
    });

    socket.on('connector:status_updated', (data: ConnectorStatus) => {
      const key = `${data.chargerId}-${data.connectorId}`;
      setConnectorStatuses((prev) => ({ ...prev, [key]: data }));
    });

    return () => {
      unsubscribeStation(stationId);
      socket.off('connect', joinRoom);
      socket.off('charger:status_updated');
      socket.off('connector:status_updated');
    };
  }, [stationId]);

  // merge REST initial data with live WebSocket updates
  // const merged = chargers.map((c) => ({
  //   ...c,
  //   status: chargerStatuses[c.id]?.status ?? c.liveStatus ?? c.status,
  //   connectors: c.connectors.map((conn) => ({
  //     ...conn,
  //     status: connectorStatuses[`${c.id}-${conn.connectorId}`]?.status ?? conn.status,
  //   })),
  // }));

  return <div>{/* render merged charger list */}</div>;
}
```

### Step 3 (Alternative) — Vue 3

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, reactive } from 'vue';
import {
  connectChargerStatus,
  subscribeStation,
  unsubscribeStation,
  getSocket,
} from '@/lib/charger-status-socket';

const props = defineProps<{ stationId: string }>();
const chargerStatuses = reactive<Record<string, any>>({});
const connectorStatuses = reactive<Record<string, any>>({});

onMounted(() => {
  const token = localStorage.getItem('access_token') ?? '';
  const socket = connectChargerStatus(token);

  const joinRoom = () => subscribeStation(props.stationId);
  socket.on('connect', joinRoom);
  if (socket.connected) joinRoom();

  socket.on('charger:status_updated', (data) => {
    chargerStatuses[data.chargerId] = data;
  });
  socket.on('connector:status_updated', (data) => {
    connectorStatuses[`${data.chargerId}-${data.connectorId}`] = data;
  });
});

onUnmounted(() => {
  const socket = getSocket();
  unsubscribeStation(props.stationId);
  socket?.off('charger:status_updated');
  socket?.off('connector:status_updated');
});
</script>
```

### Step 4 — Status Badge Component

```tsx
// StatusBadge.tsx
const STATUS_COLOR: Record<string, string> = {
  ONLINE:        'bg-green-500',
  OFFLINE:       'bg-gray-400',
  AVAILABLE:     'bg-green-400',
  CHARGING:      'bg-blue-500',
  PREPARING:     'bg-yellow-400',
  FINISHING:     'bg-yellow-600',
  FAULTED:       'bg-red-500',
  UNAVAILABLE:   'bg-gray-500',
  RESERVED:      'bg-purple-400',
  SUSPENDED_EV:  'bg-orange-400',
  SUSPENDED_EVSE:'bg-orange-500',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'bg-gray-300';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-xs font-medium ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-white opacity-80 animate-pulse" />
      {status}
    </span>
  );
}
```

### Step 5 — Merge REST initial data + WebSocket live updates

```ts
// On page load: fetch REST snapshot
const { data: chargers } = await fetch(`/api/admin/v1/stations/${stationId}/chargers/dashboard`);

// On each render: merge with live WebSocket state
const merged = chargers.map((c) => ({
  ...c,
  status: chargerStatuses[c.id]?.status ?? c.liveStatus ?? c.status,
  connectors: c.connectors.map((conn) => ({
    ...conn,
    status: connectorStatuses[`${c.id}-${conn.connectorId}`]?.status ?? conn.status,
  })),
}));
```

### Step 6 — Environment Variable

```env
# Vite
VITE_API_URL=http://localhost:4000

# Next.js
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Production — nginx WebSocket Proxy

ໃນ production (K8s / nginx), ຕ້ອງໃຫ້ nginx ສົ່ງ WebSocket ຜ່ານ — ເພີ່ມໃນ ingress config:

```nginx
location /socket.io/ {
  proxy_pass         http://admin-backend;
  proxy_http_version 1.1;
  proxy_set_header   Upgrade $http_upgrade;
  proxy_set_header   Connection "upgrade";
  proxy_set_header   Host $host;
}
```

---

## End-to-End Flow Summary

```
1. ໜ້າ Station Detail ເປີດ
   → connectChargerStatus(token)        ← ເຊື່ອມ /charger-status namespace
   → socket.on('connect') fires
   → subscribe_station({ stationId })   ← ເຂົ້າ room station:{stationId}

2. Charger ສົ່ງ StatusNotification ໄປ OCPP service
   → OCPP publishes connector.status_changed to PANDA_EV_CHARGER_STATUS queue

3. OcppStatusConsumerService ໃນ Admin ຮັບ message
   → UPDATE panda_ev_system.connectors SET status = ...
   → ChargerStatusGateway.emitConnectorStatus(stationId, {...})

4. Gateway emit 'connector:status_updated' ໄປ room station:{stationId}
   → Frontend ຮັບ event ແລະ update UI ທັນທີ (ບໍ່ຕ້ອງ reload)

5. ໜ້າ Station Detail ປິດ
   → unsubscribe_station({ stationId })  ← ອອກຈາກ room
   → socket.off(...)                     ← ລຶບ listeners
```

---

## Services NOT Changed

| Service | Reason |
|---|---|
| `panda-ev-ocpp` | Already publishes to `PANDA_EV_CHARGER_STATUS` — no change needed |
| `panda-ev-client-mobile` | Does not handle admin charger status |
| `panda-ev-notification` | Delivery layer only — has separate `/admin-stats` gateway for session events |
| `panda-ev-gateway-services` | Payment gateway — unrelated |
