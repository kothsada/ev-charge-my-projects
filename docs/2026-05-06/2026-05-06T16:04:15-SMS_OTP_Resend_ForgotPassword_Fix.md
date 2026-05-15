# SMS OTP Resend & Forgot Password Fix

**Date:** 2026-05-06  
**Service:** `panda-ev-client-mobile` (port 4001)  
**Branch:** `implement-sse-new-under-paymement`

---

## Problems Reported

1. Users stuck on OTP screen getting "Your account is already verified" when calling `resend-otp`
2. OTP SMS not arriving after resend (cooldown message said 60s but constant was 30s)
3. SMS Gateway returning 404 → 500 crash on `forgot-password`
4. SMS Gateway connect timeout (wrong port in URL)
5. `forgot-password` returning fake success with no SMS for `PENDING_VERIFICATION` users

---

## Fix 1 — `resend-otp` blocked ACTIVE users with a hard 400 error

**File:** `src/modules/auth/auth.service.ts` → `resendOtp()`

**Problem:** Single guard `user.status !== 'PENDING_VERIFICATION'` threw `BadRequestException` for ALL non-pending statuses, including `ACTIVE`. A user who verified successfully but got stuck on the OTP screen in the app received an opaque 400 error instead of being told to log in.

**Fix:** Distinguish `ACTIVE` from other statuses. Return HTTP 200 with `alreadyVerified: true` for ACTIVE users so the app can redirect to login without showing an error.

```ts
// Before
if (user.status !== 'PENDING_VERIFICATION') {
  throw new BadRequestException(i18nMessage('auth.otp_already_verified'));
}

// After
if (user.status === 'ACTIVE') {
  return { alreadyVerified: true, message: t('auth.otp_already_verified_login') };
}
if (user.status !== 'PENDING_VERIFICATION') {
  throw new BadRequestException(i18nMessage('auth.otp_already_verified'));
}
```

**New i18n key added** (`en` / `lo` / `zh`):
```json
"otp_already_verified_login": "Your account is already verified. Please log in."
```

---

## Fix 2 — OTP timing info missing from resend response

**Files:** `src/modules/auth/otp.service.ts`, `src/modules/auth/auth.service.ts`

**Problem:** `generateAndSend()` returned `void`. The app had no way to show a countdown for OTP expiry or the resend cooldown, causing users to resend too early — which overwrites the valid OTP in Redis and invalidates any in-flight SMS.

**Fix:** `generateAndSend()` now returns `{ expiresInSeconds, cooldownSeconds }`. Both `resendOtp()` and `requestResetPassword()` include these in their response.

```ts
// otp.service.ts
async generateAndSend(...): Promise<{ expiresInSeconds: number; cooldownSeconds: number }> {
  // ... existing logic ...
  return { expiresInSeconds: OTP_TTL_SECONDS, cooldownSeconds: OTP_COOLDOWN_SECONDS };
}
```

Response shape for `POST /auth/resend-otp` and `POST /auth/forgot-password`:
```json
{
  "message": "OTP code has been resent",
  "expiresInSeconds": 300,
  "cooldownSeconds": 60
}
```

The app should use `cooldownSeconds` to show a "Resend in 60s" countdown and `expiresInSeconds` to show "Code expires in 5:00".

---

## Fix 3 — OTP cooldown constant vs message discrepancy

**File:** `src/modules/auth/otp.service.ts`

**Problem:** `OTP_COOLDOWN_SECONDS = 30` but all translation files said "Please wait **60** seconds". Constant updated to match:

```ts
const OTP_COOLDOWN_SECONDS = 60;
```

---

## Fix 4 — SMS delivery: direct HTTP preferred over RabbitMQ when `SMS_GATEWAY_URL` is set

**File:** `src/modules/auth/otp.service.ts` → `sendSms()`

**Problem:** Original code only fell back to direct HTTP when RabbitMQ was **disconnected**. If RabbitMQ was connected but the notification service wasn't consuming the queue, OTP messages piled up undelivered.

**Fix:** Prefer direct HTTP when `SMS_GATEWAY_URL` is configured (OTPs are time-critical). Fall back to RabbitMQ if HTTP fails. Fall back to a warning log if both are unavailable.

```ts
// New delivery priority
if (process.env.SMS_GATEWAY_URL) {
  try {
    await this.sendSmsHttp(phone, message, userId);
    return;
  } catch (err) {
    this.logger.warn(`Direct SMS gateway failed (${err.message}) — falling back to RabbitMQ`);
  }
}
if (this.rabbitMQ.isConnected) {
  await this.rabbitMQ.publish(SMS_QUEUE, { ... });
  return;
}
this.logger.warn(`SMS not sent — no gateway or RabbitMQ [DEV ONLY]`);
```

---

## Fix 5 — Wrong `SMS_GATEWAY_URL` in `create-secret.sh` (404 then timeout)

**File:** `create-secret.sh`

**Round 1 — 404:** URL was missing port and path:
```bash
# Before (wrong)
SMS_GATEWAY_URL='http://panda-notification-api-service'

# After round 1 (still wrong port)
SMS_GATEWAY_URL='http://panda-notification-api-service.panda-ev-prod.svc.cluster.local:5001/api/notification/v1/sms/send'
```

**Round 2 — Connect timeout:** The K8s ClusterIP service exposes port **80** (not 5001 — that's the container port). Final correct URL:
```bash
SMS_GATEWAY_URL='http://panda-notification-api-service/api/notification/v1/sms/send'
```

The notification service endpoint is `POST /api/notification/v1/sms/send` (`SmsController` with global prefix `api/notification`). The `SendSmsDto` payload from `sendSmsHttp` matches exactly:
```json
{
  "phoneNumber": "+8562078559999",
  "message": "Your Panda EV Hub verification code is: 123456...",
  "smsType": "OTP",
  "header": "TEST",
  "userId": "uuid"
}
```

---

## Fix 6 — `forgot-password` silently returned success with no SMS for `PENDING_VERIFICATION` users

**File:** `src/modules/auth/auth.service.ts` → `requestResetPassword()`

**Problem:** The guard `if (!user || user.status !== 'ACTIVE')` caught `PENDING_VERIFICATION` users and returned a fake `{ message: 'OTP code has been sent' }` without sending anything. A user who registered but never verified their account would call `forgot-password`, see "OTP sent", but receive no SMS.

**Fix:** Split into three explicit cases:

```ts
// Non-existent / suspended / inactive — silent return (don't leak account state)
if (!user || user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
  return { message: t('auth.otp_sent') };
}

// PENDING_VERIFICATION — send OTP so they can complete account verification
// Return pendingVerification: true so the app redirects to verify-otp, not reset-password
if (user.status === 'PENDING_VERIFICATION') {
  const { expiresInSeconds, cooldownSeconds } =
    await this.otpService.generateAndSend(identifier, ip, user.id);
  return { message: t('auth.otp_sent'), pendingVerification: true, expiresInSeconds, cooldownSeconds };
}

// ACTIVE — normal password reset OTP
const { expiresInSeconds, cooldownSeconds } =
  await this.otpService.generateAndSend(identifier, ip, user.id);
return { message: t('auth.otp_sent'), expiresInSeconds, cooldownSeconds };
```

**App behaviour on `pendingVerification: true`:** redirect user to the verify-otp screen (use `POST /auth/verify-otp`) instead of the reset-password screen.

| User status | Before | After |
|---|---|---|
| `PENDING_VERIFICATION` | Silent return — no SMS sent ❌ | OTP sent + `pendingVerification: true` ✅ |
| `ACTIVE` | OTP sent ✅ | OTP sent ✅ |
| `SUSPENDED` / `INACTIVE` / not found | Silent return ✅ | Silent return ✅ |

---

## Deployments

All fixes deployed to `panda-ev-prod` namespace via:
```bash
./create-secret.sh panda-ev-prod
kubectl rollout restart deployment/panda-mobile-api -n panda-ev-prod
```
