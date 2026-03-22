import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';

interface FcmNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  channelId?: string;
  priority?: 'high' | 'normal';
}

interface FcmSendResult {
  sent: number;
  failed: number;
  staleTokens: string[];
}

const STALE_TOKEN_CODES = [
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-recipient',
];

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private configured = false;
  private app: admin.app.App | null = null;

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    // Option A: service account file path
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
      try {
        const serviceAccount = JSON.parse(
          fs.readFileSync(serviceAccountPath, 'utf-8'),
        ) as admin.ServiceAccount;
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        }, 'notification-service');
        this.configured = true;
        this.logger.log('Firebase initialized from service account file');
        return;
      } catch (err) {
        this.logger.warn(
          `Failed to load Firebase service account from file: ${(err as Error).message}`,
        );
      }
    }

    // Option B: individual env vars
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      try {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        }, 'notification-service');
        this.configured = true;
        this.logger.log('Firebase initialized from environment variables');
        return;
      } catch (err) {
        this.logger.warn(
          `Failed to initialize Firebase from env vars: ${(err as Error).message}`,
        );
      }
    }

    this.logger.warn('Firebase not configured (soft-fail) — FCM notifications disabled');
  }

  async send(tokens: string[], notification: FcmNotificationPayload): Promise<FcmSendResult> {
    if (!this.configured || !this.app) {
      this.logger.warn('FCM not configured — skipping send');
      return { sent: 0, failed: tokens.length, staleTokens: [] };
    }

    if (!tokens.length) {
      return { sent: 0, failed: 0, staleTokens: [] };
    }

    const messaging = admin.messaging(this.app);
    const BATCH_SIZE = 500;
    let totalSent = 0;
    let totalFailed = 0;
    const staleTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);

      try {
        const multicastMessage: admin.messaging.MulticastMessage = {
          tokens: batch,
          notification: {
            title: notification.title,
            body: notification.body,
            imageUrl: notification.imageUrl,
          },
          data: notification.data,
          android: {
            priority: notification.priority === 'high' ? 'high' : 'normal',
            notification: {
              channelId: notification.channelId ?? 'default',
              imageUrl: notification.imageUrl,
            },
          },
          apns: {
            payload: {
              aps: {
                contentAvailable: true,
                sound: 'default',
              },
            },
          },
        };

        const response = await messaging.sendEachForMulticast(multicastMessage);

        totalSent += response.successCount;
        totalFailed += response.failureCount;

        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            if (STALE_TOKEN_CODES.includes(resp.error.code)) {
              staleTokens.push(batch[idx]);
            }
          }
        });
      } catch (err) {
        this.logger.error(`FCM multicast batch failed: ${(err as Error).message}`);
        totalFailed += batch.length;
      }
    }

    this.logger.log(
      `FCM send complete: sent=${totalSent}, failed=${totalFailed}, stale=${staleTokens.length}`,
    );
    return { sent: totalSent, failed: totalFailed, staleTokens };
  }

  async sendToTopic(
    topic: string,
    notification: FcmNotificationPayload,
  ): Promise<{ messageId: string } | null> {
    if (!this.configured || !this.app) {
      this.logger.warn('FCM not configured — skipping topic send');
      return null;
    }

    try {
      const messaging = admin.messaging(this.app);
      const messageId = await messaging.send({
        topic,
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl,
        },
        data: notification.data,
        android: {
          priority: notification.priority === 'high' ? 'high' : 'normal',
        },
      });

      this.logger.log(`FCM topic message sent: ${messageId}`);
      return { messageId };
    } catch (err) {
      this.logger.error(`FCM topic send failed: ${(err as Error).message}`);
      return null;
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }
}
