import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/admin-stats', cors: { origin: '*' } })
export class AdminStatsGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AdminStatsGateway.name);

  afterInit() {
    this.logger.log('AdminStats WebSocket gateway initialized (/admin-stats)');
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
