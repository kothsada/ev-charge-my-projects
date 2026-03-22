import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      service: 'panda-ev-notification',
      version: '1.0.0',
      status: 'running',
    };
  }
}
