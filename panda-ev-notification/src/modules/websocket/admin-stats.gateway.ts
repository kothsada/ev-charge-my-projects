import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({ namespace: '/admin-stats', cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' } })
export class AdminStatsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AdminStatsGateway.name);

  afterInit() {
    this.logger.log('AdminStats WebSocket gateway initialized (/admin-stats)');
  }

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth as Record<string, string>)?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn(`WS /admin-stats: connection rejected — no token (id=${client.id})`);
      client.emit('auth_error', 'Missing authentication token');
      client.disconnect(true);
      return;
    }

    const secret = process.env.JWT_SECRET ?? process.env.ADMIN_STATS_WS_SECRET;
    if (!secret) {
      this.logger.error('JWT_SECRET not configured — rejecting all WebSocket connections');
      client.emit('auth_error', 'Server misconfiguration');
      client.disconnect(true);
      return;
    }

    try {
      jwt.verify(token, secret);
      this.logger.debug(`WS /admin-stats: client connected (id=${client.id})`);
    } catch (err) {
      this.logger.warn(
        `WS /admin-stats: connection rejected — invalid token (id=${client.id}): ${(err as Error).message}`,
      );
      client.emit('auth_error', 'Invalid or expired token');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`WS /admin-stats: client disconnected (id=${client.id})`);
  }

  emitSessionUpdate(payload: Record<string, unknown>) {
    this.server.emit('session:live_update', payload);
  }

  emitHourlyStatUpdate(payload: Record<string, unknown>) {
    this.server.emit('stats:hourly_updated', payload);
  }

  emitNotificationSent(payload: Record<string, unknown>) {
    this.server.emit('notification:sent', payload);
  }

  emitSystemAlert(payload: Record<string, unknown>) {
    this.server.emit('system:alert', payload);
  }
}
