/**
 * ServiceJwtService — RS256 service-to-service JWT signing and verification.
 *
 * Each service has one private key (for signing outgoing tokens) and N public
 * keys (one per trusted peer service, for verifying incoming tokens).
 *
 * Tokens are short-lived (30 s) and each jti is stored in Redis for 60 s to
 * prevent replay attacks.
 *
 * ── Key loading (two options, file path takes priority) ──────────────────
 *
 * OPTION A — File paths (local dev / Docker volume mount):
 *
 *   SERVICE_JWT_PRIVATE_KEY_PATH=/app/keys/admin.pem
 *
 *   TRUSTED_SERVICE_PUBLIC_KEYS_DIR=/app/keys
 *   TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp
 *   # Format: "<issuer-name>:<filename-stem>" comma-separated
 *   # Loads /app/keys/mobile.pub  for iss=mobile-api
 *   # Loads /app/keys/ocpp.pub    for iss=ocpp-csms
 *
 * OPTION B — Base64-encoded PEM (K8s Secrets / CI):
 *
 *   SERVICE_JWT_PRIVATE_KEY=<base64(private.pem)>
 *   TRUSTED_SERVICE_PUBLIC_KEYS=[{"iss":"mobile-api","key":"<base64(mobile.pub)>"}]
 *
 * ── User-facing JWT (RS256 for access tokens) ────────────────────────────
 *
 *   JWT_PRIVATE_KEY_PATH=/app/keys/admin.pem   OR  JWT_PRIVATE_KEY=<base64>
 *   JWT_PUBLIC_KEY_PATH=/app/keys/admin.pub    OR  JWT_PUBLIC_KEY=<base64>
 */
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { RedisService } from '../../configs/redis/redis.service';

export interface ServiceTokenPayload {
  iss: string; // issuer: own SERVICE_NAME
  aud: string; // audience: target service name or queue
  iat: number;
  exp: number;
  jti: string; // unique ID — checked against Redis to prevent replay
}

interface TrustedKey {
  iss: string;
  key: string; // base64-encoded PEM  (used by Option B JSON array)
}

@Injectable()
export class ServiceJwtService {
  private readonly logger = new Logger(ServiceJwtService.name);

  readonly serviceName: string;
  private readonly privateKey: string | null = null;
  private readonly trustedKeys = new Map<string, string>(); // iss → PEM

  private readonly TOKEN_TTL_S = 30;
  private readonly JTI_BLACKLIST_TTL_S = 60;

  constructor(private readonly redis: RedisService) {
    this.serviceName = process.env.SERVICE_NAME ?? 'unknown-service';
    this.privateKey = this.loadPrivateKey();
    this.loadTrustedKeys();
  }

  // ---------------------------------------------------------------------------
  // Key loading helpers
  // ---------------------------------------------------------------------------

  /**
   * Load own private key.
   * Priority: SERVICE_JWT_PRIVATE_KEY_PATH (file) → SERVICE_JWT_PRIVATE_KEY (base64)
   */
  private loadPrivateKey(): string | null {
    // Option A: file path
    const keyPath = process.env.SERVICE_JWT_PRIVATE_KEY_PATH;
    if (keyPath) {
      try {
        const pem = fs.readFileSync(keyPath, 'utf-8');
        this.logger.log(`Service JWT private key loaded from file: ${keyPath}`);
        return pem;
      } catch (err) {
        this.logger.error(
          `Failed to read SERVICE_JWT_PRIVATE_KEY_PATH "${keyPath}": ${(err as Error).message}`,
        );
        return null;
      }
    }

    // Option B: base64 env var
    const b64 = process.env.SERVICE_JWT_PRIVATE_KEY;
    if (b64) {
      try {
        const pem = Buffer.from(b64, 'base64').toString('utf-8');
        this.logger.log('Service JWT private key loaded from env (base64)');
        return pem;
      } catch {
        this.logger.error('Failed to decode SERVICE_JWT_PRIVATE_KEY (base64)');
        return null;
      }
    }

    this.logger.warn(
      'SERVICE_JWT_PRIVATE_KEY_PATH / SERVICE_JWT_PRIVATE_KEY not set — outgoing service tokens disabled',
    );
    return null;
  }

  /**
   * Load trusted peer public keys.
   *
   * Option A (file-based):
   *   TRUSTED_SERVICE_PUBLIC_KEYS_DIR=/app/keys
   *   TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp
   *   → reads /app/keys/mobile.pub  tagged as iss="mobile-api"
   *   → reads /app/keys/ocpp.pub    tagged as iss="ocpp-csms"
   *
   * Option B (base64 JSON array):
   *   TRUSTED_SERVICE_PUBLIC_KEYS=[{"iss":"mobile-api","key":"<base64>"}]
   */
  private loadTrustedKeys(): void {
    const keysDir = process.env.TRUSTED_SERVICE_PUBLIC_KEYS_DIR;
    const issuersRaw = process.env.TRUSTED_SERVICE_ISSUERS;

    if (keysDir && issuersRaw) {
      // Option A: directory + issuer list
      const entries = issuersRaw.split(',').map((s) => s.trim());
      for (const entry of entries) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) {
          this.logger.warn(
            `TRUSTED_SERVICE_ISSUERS entry "${entry}" missing colon — expected "iss-name:file-stem"`,
          );
          continue;
        }
        const issuer = entry.slice(0, colonIdx).trim();
        const fileStem = entry.slice(colonIdx + 1).trim();
        const filePath = path.join(keysDir, `${fileStem}.pub`);
        try {
          const pem = fs.readFileSync(filePath, 'utf-8');
          this.trustedKeys.set(issuer, pem);
          this.logger.log(
            `Trusted key loaded: iss="${issuer}" ← ${filePath}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to read public key for "${issuer}" at "${filePath}": ${(err as Error).message}`,
          );
        }
      }
      return;
    }

    // Option B: base64 JSON array
    const trustedRaw = process.env.TRUSTED_SERVICE_PUBLIC_KEYS;
    if (trustedRaw) {
      try {
        const parsed = JSON.parse(trustedRaw) as TrustedKey[];
        for (const entry of parsed) {
          const pem = Buffer.from(entry.key, 'base64').toString('utf-8');
          this.trustedKeys.set(entry.iss, pem);
        }
        this.logger.log(
          `Trusted service keys loaded (base64): [${[...this.trustedKeys.keys()].join(', ')}]`,
        );
      } catch {
        this.logger.error(
          'Failed to parse TRUSTED_SERVICE_PUBLIC_KEYS — incoming service tokens will be rejected',
        );
      }
      return;
    }

    this.logger.warn(
      'No trusted service public keys configured — incoming service tokens will NOT be verified',
    );
  }

  // ---------------------------------------------------------------------------
  // Sign / Verify
  // ---------------------------------------------------------------------------

  /**
   * Sign a short-lived (30 s) RS256 JWT for the target service/queue.
   * Returns null if private key is not configured.
   */
  sign(audience: string): string | null {
    if (!this.privateKey) return null;

    const header = this.base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = this.base64url(
      JSON.stringify({
        iss: this.serviceName,
        aud: audience,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + this.TOKEN_TTL_S,
        jti: crypto.randomUUID(),
      } satisfies ServiceTokenPayload),
    );

    const signingInput = `${header}.${payload}`;
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  /**
   * Verify an incoming service token.
   * Returns the decoded payload on success, null on any failure.
   *
   * Checks (in order):
   *   1. JWT structure (3 parts)
   *   2. Token not expired
   *   3. Issuer has a trusted public key
   *   4. RS256 signature valid
   *   5. jti not seen before (anti-replay via Redis)
   */
  async verify(
    token: string | undefined | null,
  ): Promise<ServiceTokenPayload | null> {
    if (!token) return null;

    if (this.trustedKeys.size === 0) {
      this.logger.warn(
        'No trusted keys configured — skipping service token verification (open)',
      );
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      this.logger.warn('Malformed service token (expected 3 parts)');
      return null;
    }

    let payload: ServiceTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      ) as ServiceTokenPayload;
    } catch {
      this.logger.warn('Failed to decode service token payload');
      return null;
    }

    // Check expiry before crypto (fast path)
    const nowS = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowS) {
      this.logger.warn(`Expired service token from "${payload.iss}"`);
      return null;
    }

    const publicKey = this.trustedKeys.get(payload.iss);
    if (!publicKey) {
      this.logger.warn(
        `No trusted key for issuer "${payload.iss}" — token rejected`,
      );
      return null;
    }

    // Verify RS256 signature
    const signingInput = `${parts[0]}.${parts[1]}`;
    const sigBuffer = Buffer.from(parts[2], 'base64url');
    try {
      const valid = crypto
        .createVerify('RSA-SHA256')
        .update(signingInput)
        .verify(publicKey, sigBuffer);

      if (!valid) {
        this.logger.warn(
          `Invalid RS256 signature on token from "${payload.iss}"`,
        );
        return null;
      }
    } catch (err) {
      this.logger.warn(
        `Signature verification error for "${payload.iss}": ${(err as Error).message}`,
      );
      return null;
    }

    // Anti-replay: reject if jti was already seen
    if (payload.jti) {
      const jtiKey = `svc:jti:${payload.jti}`;
      const alreadySeen = await this.redis.get(jtiKey);
      if (alreadySeen) {
        this.logger.warn(
          `Replayed service token (jti=${payload.jti}) from "${payload.iss}"`,
        );
        return null;
      }
      await this.redis.set(jtiKey, '1', this.JTI_BLACKLIST_TTL_S);
    }

    return payload;
  }

  get isSigningConfigured(): boolean {
    return this.privateKey !== null;
  }

  // ---------------------------------------------------------------------------

  private base64url(input: string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
}
