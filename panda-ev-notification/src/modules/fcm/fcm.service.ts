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
  /** Tally of every FCM error code encountered: { 'messaging/sender-id-mismatch': 2, … } */
  errorCodes: Record<string, number>;
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
        }, 'notification-api');
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
        }, 'notification-api');
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
      return { sent: 0, failed: tokens.length, staleTokens: [], errorCodes: {} };
    }

    if (!tokens.length) {
      return { sent: 0, failed: 0, staleTokens: [], errorCodes: {} };
    }

    const messaging = admin.messaging(this.app);
    const BATCH_SIZE = 500;
    let totalSent = 0;
    let totalFailed = 0;
    const staleTokens: string[] = [];
    const errorCodes: Record<string, number> = {};

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
              channelId: notification.channelId ?? 'panda_ev_high_importance',
              imageUrl: notification.imageUrl,
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
            },
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
            const code = resp.error.code;
            // Track frequency of every error code for diagnostics
            errorCodes[code] = (errorCodes[code] ?? 0) + 1;

            if (STALE_TOKEN_CODES.includes(code)) {
              staleTokens.push(batch[idx]);
            } else {
              // Log non-stale FCM errors so we can diagnose without reading raw SDK
              this.logger.warn(
                `FCM error for token[${i + idx}]: ${code} — ${resp.error.message ?? ''}`,
              );
            }
          }
        });
      } catch (err) {
        this.logger.error(`FCM multicast batch failed: ${(err as Error).message}`);
        totalFailed += batch.length;
      }
    }

    const errorSummary = Object.entries(errorCodes)
      .map(([code, count]) => `${code}×${count}`)
      .join(', ');
    this.logger.log(
      `FCM send complete: sent=${totalSent}, failed=${totalFailed}, stale=${staleTokens.length}` +
        (errorSummary ? `, errors=[${errorSummary}]` : ''),
    );
    return { sent: totalSent, failed: totalFailed, staleTokens, errorCodes };
  }

  async subscribeToTopics(token: string, topics: string[]): Promise<void> {
    if (!this.configured || !this.app) {
      this.logger.warn('FCM not configured — skipping topic subscription');
      return;
    }
    const messaging = admin.messaging(this.app);
    for (const topic of topics) {
      try {
        await messaging.subscribeToTopic([token], topic);
        this.logger.debug(`Subscribed token to topic "${topic}"`);
      } catch (err) {
        this.logger.warn(
          `Failed to subscribe token to topic "${topic}": ${(err as Error).message}`,
        );
      }
    }
  }

  async unsubscribeFromTopics(token: string, topics: string[]): Promise<void> {
    if (!this.configured || !this.app) return;
    const messaging = admin.messaging(this.app);
    for (const topic of topics) {
      try {
        await messaging.unsubscribeFromTopic([token], topic);
        this.logger.debug(`Unsubscribed token from topic "${topic}"`);
      } catch {
        // ignore — token may already be invalid or not subscribed
      }
    }
  }

  async sendDataToTopic(
    topic: string,
    data: Record<string, string>,
  ): Promise<{ messageId: string } | null> {
    if (!this.configured || !this.app) {
      this.logger.warn('FCM not configured — skipping data topic send');
      return null;
    }
    try {
      const messaging = admin.messaging(this.app);
      const messageId = await messaging.send({
        topic,
        data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '5', 'apns-push-type': 'background' }, payload: { aps: { 'content-available': 1 } } },
      });
      this.logger.log(`FCM silent data message sent to topic "${topic}": ${messageId}`);
      return { messageId };
    } catch (err) {
      this.logger.error(`FCM silent data send failed: ${(err as Error).message}`);
      return null;
    }
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
