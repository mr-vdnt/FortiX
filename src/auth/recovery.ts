import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { recoveryChallenges, users } from '../db/schema.js';
import { getJwtSecret } from '../lib/jwt-security.js';
import { issueAuthActionToken } from '../lib/auth-tokens.js';
import {
  DeliveryChannel,
  resolveEmailDeliveryProvider,
  resolveSmsDeliveryProvider,
} from './providers.js';
import { redisConnection } from '../redis.js';
import { logger } from '../lib/logger.js';

export type RecoveryPurpose = 'PASSWORD_RESET' | 'PHONE_VERIFICATION';

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_MAX_RESENDS = 5;

const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const EMAIL_BASIC_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const challengeLocks = new Map<string, Promise<any>>();
const localRateBuckets = new Map<string, { count: number; resetAt: number }>();
const syntheticResendTimestamps = new Map<string, number>();

export function normalizePhoneE164(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s\-().]/g, '');
  if (!E164_PHONE_REGEX.test(compact)) {
    return null;
  }
  return compact;
}

export function maskEmailAddress(email: string): string {
  const [localPart, domainPart] = email.split('@');
  if (!localPart || !domainPart) return '***@***';
  const visible = localPart.length <= 2 ? localPart.slice(0, 1) : localPart.slice(0, 2);
  return `${visible}***@${domainPart}`;
}

export function maskPhoneE164(phoneE164: string): string {
  if (phoneE164.length <= 6) return '+***';
  const prefix = phoneE164.slice(0, 3);
  const suffix = phoneE164.slice(-4);
  return `${prefix}${'*'.repeat(Math.max(4, phoneE164.length - 7))}${suffix}`;
}

export interface ParsedRecoveryIdentifier {
  kind: 'email' | 'phone';
  normalized: string;
  masked: string;
  channel: DeliveryChannel;
}

export function parseLoginOrRecoveryIdentifier(rawIdentifier: string): ParsedRecoveryIdentifier | null {
  if (!rawIdentifier || typeof rawIdentifier !== 'string') return null;
  const trimmed = rawIdentifier.trim();
  if (!trimmed || trimmed.length > 254) return null;

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    if (!EMAIL_BASIC_REGEX.test(email)) return null;
    return {
      kind: 'email',
      normalized: email,
      masked: maskEmailAddress(email),
      channel: 'EMAIL',
    };
  }

  const phone = normalizePhoneE164(trimmed);
  if (phone) {
    return {
      kind: 'phone',
      normalized: phone,
      masked: maskPhoneE164(phone),
      channel: 'SMS',
    };
  }

  return null;
}

export function getOtpHmacSecret(): Buffer {
  const explicit = process.env.OTP_HMAC_SECRET;
  if (explicit && explicit.trim().length >= 32) {
    return crypto.createHash('sha256').update(explicit.trim(), 'utf8').digest();
  }
  if (process.env.NODE_ENV === 'production' && process.env.STRICT_PRODUCTION_SECRETS === 'true') {
    throw new Error('OTP_HMAC_SECRET (minimum 32 characters) must be configured when STRICT_PRODUCTION_SECRETS=true');
  }
  // Cryptographic domain separation from JWT signing secret
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update('fortix:otp-challenge-hmac-key:v1', 'utf8')
    .digest();
}

export function generateSixDigitOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function computeOtpHmac(challengeId: string, purpose: RecoveryPurpose, otp: string): string {
  return crypto
    .createHmac('sha256', getOtpHmacSecret())
    .update(`${challengeId}:${purpose}:${otp.trim()}`, 'utf8')
    .digest('hex');
}

function timingSafeHexEqual(hexA: string, hexB: string): boolean {
  if (!hexA || !hexB || hexA.length !== hexB.length) return false;
  const bufA = Buffer.from(hexA, 'hex');
  const bufB = Buffer.from(hexB, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Synthetic opaque challenge IDs look identical to standard v4 UUIDs (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
// while embedding an 8-hex-char keyed HMAC tag in the trailing segment so unknown accounts / unverified phones
// never allocate DB rows or leak account existence.
function createSyntheticChallengeId(): string {
  const baseUuid = uuidv4();
  const prefix = baseUuid.slice(0, 24);
  const tag = crypto
    .createHmac('sha256', getOtpHmacSecret())
    .update(`synthetic-challenge:${prefix}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return `${prefix}${tag}`;
}

export function isSyntheticChallengeId(challengeId: string): boolean {
  if (!challengeId || challengeId.length !== 36) return false;
  const prefix = challengeId.slice(0, 24);
  const expectedTag = crypto
    .createHmac('sha256', getOtpHmacSecret())
    .update(`synthetic-challenge:${prefix}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return timingSafeHexEqual(challengeId.slice(24).toLowerCase(), expectedTag.toLowerCase());
}

async function consumeSlidingBucket(key: string, max: number, windowMs: number): Promise<boolean> {
  const isSkippedTestLimiter =
    (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') &&
    process.env.ENFORCE_AUTH_RATE_LIMIT !== 'true';
  if (isSkippedTestLimiter) {
    return true;
  }

  const now = Date.now();
  // Prune expired local buckets
  if (localRateBuckets.size > 2000) {
    for (const [k, v] of localRateBuckets.entries()) {
      if (v.resetAt <= now) localRateBuckets.delete(k);
    }
  }

  try {
    const redisKey = `fortix:otp-rl:${key}`;
    const current = await redisConnection.incr(redisKey);
    if (current === 1) {
      await redisConnection.pexpire(redisKey, windowMs);
    }
    return current <= max;
  } catch {
    const existing = localRateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      localRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    existing.count += 1;
    return existing.count <= max;
  }
}

function hashDimension(value: string): string {
  return crypto.createHmac('sha256', getOtpHmacSecret()).update(value).digest('hex').slice(0, 24);
}

export async function checkMultiDimensionalOtpRateLimit(params: {
  identifierNormalized?: string;
  ip?: string;
  channel?: DeliveryChannel;
  challengeId?: string;
  action: 'request' | 'verify';
}): Promise<{ allowed: boolean }> {
  const windowMs = 15 * 60 * 1000; // 15-minute window
  const ipHash = hashDimension(params.ip || 'unknown-ip');

  if (params.action === 'request') {
    const ipAllowed = await consumeSlidingBucket(`req:ip:${ipHash}`, 15, windowMs);
    if (!ipAllowed) return { allowed: false };

    if (params.identifierNormalized) {
      const idHash = hashDimension(params.identifierNormalized);
      const idAllowed = await consumeSlidingBucket(`req:id:${idHash}`, 5, windowMs);
      if (!idAllowed) return { allowed: false };
    }

    if (params.channel) {
      const chAllowed = await consumeSlidingBucket(`req:ch:${params.channel}:${ipHash}`, 12, windowMs);
      if (!chAllowed) return { allowed: false };
    }
  } else {
    const ipVerifyAllowed = await consumeSlidingBucket(`ver:ip:${ipHash}`, 30, windowMs);
    if (!ipVerifyAllowed) return { allowed: false };

    if (params.challengeId) {
      const chHash = hashDimension(params.challengeId);
      const chVerifyAllowed = await consumeSlidingBucket(`ver:cid:${chHash}`, 10, windowMs);
      if (!chVerifyAllowed) return { allowed: false };
    }
  }

  return { allowed: true };
}

async function withChallengeLock<T>(challengeId: string, fn: () => Promise<T>): Promise<T> {
  const prev = challengeLocks.get(challengeId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  challengeLocks.set(challengeId, prev.then(() => gate));

  await prev;
  try {
    return await fn();
  } finally {
    release();
    Promise.resolve().then(() => {
      challengeLocks.delete(challengeId);
    });
  }
}

export async function invalidateUserRecoveryChallenges(
  userId: string,
  purpose?: RecoveryPurpose,
  reason = 'SUPERSEDED'
): Promise<void> {
  const conditions = [
    eq(recoveryChallenges.userId, userId),
    isNull(recoveryChallenges.consumedAt),
    isNull(recoveryChallenges.invalidatedAt),
  ];
  if (purpose) {
    conditions.push(eq(recoveryChallenges.purpose, purpose));
  }
  await db
    .update(recoveryChallenges)
    .set({
      invalidatedAt: new Date(),
      invalidationReason: reason,
    })
    .where(and(...conditions));
}

export interface PasswordRecoveryOtpDispatchResponse {
  genericMessage: string;
  challengeId: string;
  channel: DeliveryChannel;
  destinationMasked: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  devOtpCode?: string;
}

const GENERIC_RECOVERY_MESSAGE =
  "If an account matches the information provided, we'll send verification instructions.";

export async function requestPasswordRecoveryOtp(params: {
  identifier: string;
  ip?: string;
}): Promise<{ ok: true; data: PasswordRecoveryOtpDispatchResponse } | { ok: false; status: number; error: string; code: string }> {
  const parsed = parseLoginOrRecoveryIdentifier(params.identifier);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: 'Enter a valid email address or E.164 phone number (e.g., +919876543210).',
      code: 'INVALID_RECOVERY_IDENTIFIER',
    };
  }

  const rl = await checkMultiDimensionalOtpRateLimit({
    identifierNormalized: parsed.normalized,
    ip: params.ip,
    channel: parsed.channel,
    action: 'request',
  });
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many verification requests. Please wait before trying again.',
      code: 'RECOVERY_RATE_LIMITED',
    };
  }

  const [matchedUser] =
    parsed.kind === 'email'
      ? await db.select().from(users).where(eq(users.email, parsed.normalized)).limit(1)
      : await db.select().from(users).where(eq(users.phoneE164, parsed.normalized)).limit(1);

  // Security Policy:
  // 1. Unknown accounts MUST NOT leak non-existence.
  // 2. SMS OTP MUST ONLY be sent when phoneVerified === true; unverified phones receive the identical generic response.
  const eligibleForDispatch =
    Boolean(matchedUser) &&
    (parsed.kind === 'email' || (parsed.kind === 'phone' && matchedUser!.phoneVerified === true));

  if (!eligibleForDispatch || !matchedUser) {
    // Perform constant-work dummy HMAC generation so response latency matches real challenge creation
    const syntheticId = createSyntheticChallengeId();
    computeOtpHmac(syntheticId, 'PASSWORD_RESET', generateSixDigitOtp());
    syntheticResendTimestamps.set(syntheticId, Date.now() + OTP_RESEND_COOLDOWN_MS);
    if (syntheticResendTimestamps.size > 1000) {
      const oldestKey = syntheticResendTimestamps.keys().next().value;
      if (oldestKey) syntheticResendTimestamps.delete(oldestKey);
    }

    return {
      ok: true,
      data: {
        genericMessage: GENERIC_RECOVERY_MESSAGE,
        challengeId: syntheticId,
        channel: parsed.channel,
        destinationMasked: parsed.masked,
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      },
    };
  }

  await invalidateUserRecoveryChallenges(matchedUser.id, 'PASSWORD_RESET', 'NEW_CHALLENGE_REQUESTED');

  const challengeId = uuidv4();
  const rawOtp = generateSixDigitOtp();
  const otpHmac = computeOtpHmac(challengeId, 'PASSWORD_RESET', rawOtp);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);

  await db.insert(recoveryChallenges).values({
    id: challengeId,
    userId: matchedUser.id,
    channel: parsed.channel,
    purpose: 'PASSWORD_RESET',
    destinationMasked: parsed.masked,
    otpHmac,
    expiresAt,
    failedAttempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    resendCount: 0,
    lastSentAt: now,
    resendAvailableAt,
  });

  const delivery =
    parsed.channel === 'EMAIL'
      ? await resolveEmailDeliveryProvider().send({
          to: matchedUser.email,
          purpose: 'PASSWORD_RESET_OTP',
          subject: 'Your FortiX password reset verification code',
          codeOrToken: rawOtp,
          expiresAt,
        })
      : await resolveSmsDeliveryProvider().send({
          toPhoneE164: matchedUser.phoneE164!,
          purpose: 'PASSWORD_RESET_OTP',
          otpCode: rawOtp,
          expiresAt,
        });

  if (!delivery.delivered) {
    await db
      .update(recoveryChallenges)
      .set({
        invalidatedAt: new Date(),
        invalidationReason: delivery.errorCode || 'DELIVERY_FAILED',
      })
      .where(eq(recoveryChallenges.id, challengeId));

    logger.warn(
      {
        event: 'auth.recovery.delivery_failed',
        channel: parsed.channel,
        provider: delivery.provider,
        errorCode: delivery.errorCode,
      },
      '[AuthRecovery] Challenge invalidated due to notification provider failure'
    );
  } else {
    logger.info(
      {
        event: 'auth.recovery.challenge_issued',
        channel: parsed.channel,
        provider: delivery.provider,
      },
      '[AuthRecovery] Password recovery OTP challenge issued'
    );
  }

  const exposeDevOtp =
    delivery.delivered &&
    delivery.provider === 'dev-sandbox-outbox' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false';

  return {
    ok: true,
    data: {
      genericMessage: GENERIC_RECOVERY_MESSAGE,
      challengeId,
      channel: parsed.channel,
      destinationMasked: parsed.masked,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      ...(exposeDevOtp ? { devOtpCode: rawOtp } : {}),
    },
  };
}

export async function resendPasswordRecoveryOtp(params: {
  challengeId: string;
  ip?: string;
}): Promise<
  | { ok: true; message: string; resendCooldownSeconds: number; expiresInSeconds: number; devOtpCode?: string }
  | { ok: false; status: number; error: string; code: string; retryAfterSeconds?: number }
> {
  const rl = await checkMultiDimensionalOtpRateLimit({
    ip: params.ip,
    challengeId: params.challengeId,
    action: 'request',
  });
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many verification requests. Please wait before trying again.',
      code: 'RECOVERY_RATE_LIMITED',
    };
  }

  if (isSyntheticChallengeId(params.challengeId)) {
    const unlockAt = syntheticResendTimestamps.get(params.challengeId) || 0;
    const nowMs = Date.now();
    if (unlockAt > nowMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((unlockAt - nowMs) / 1000));
      return {
        ok: false,
        status: 429,
        error: `Please wait ${retryAfterSeconds}s before requesting another code.`,
        code: 'OTP_RESEND_COOLDOWN',
        retryAfterSeconds,
      };
    }
    syntheticResendTimestamps.set(params.challengeId, nowMs + OTP_RESEND_COOLDOWN_MS);
    return {
      ok: true,
      message: GENERIC_RECOVERY_MESSAGE,
      resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  return withChallengeLock(params.challengeId, async () => {
    const [challenge] = await db
      .select()
      .from(recoveryChallenges)
      .where(
        and(
          eq(recoveryChallenges.id, params.challengeId),
          eq(recoveryChallenges.purpose, 'PASSWORD_RESET')
        )
      )
      .limit(1);

    if (!challenge || challenge.consumedAt || challenge.invalidatedAt) {
      return {
        ok: false,
        status: 400,
        error: 'This verification session is no longer active. Request a new reset code.',
        code: 'CHALLENGE_INACTIVE',
      };
    }

    const now = new Date();
    const cooldownMsRemaining = new Date(challenge.resendAvailableAt).getTime() - now.getTime();
    if (cooldownMsRemaining > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(cooldownMsRemaining / 1000));
      return {
        ok: false,
        status: 429,
        error: `Please wait ${retryAfterSeconds}s before requesting another code.`,
        code: 'OTP_RESEND_COOLDOWN',
        retryAfterSeconds,
      };
    }

    if (challenge.resendCount >= OTP_MAX_RESENDS) {
      await db
        .update(recoveryChallenges)
        .set({ invalidatedAt: now, invalidationReason: 'MAX_RESENDS_EXCEEDED' })
        .where(eq(recoveryChallenges.id, challenge.id));
      return {
        ok: false,
        status: 429,
        error: 'Maximum resend limit reached. Start a new password reset request.',
        code: 'OTP_MAX_RESENDS_EXCEEDED',
      };
    }

    const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || (challenge.channel === 'SMS' && (!user.phoneE164 || !user.phoneVerified))) {
      await db
        .update(recoveryChallenges)
        .set({ invalidatedAt: now, invalidationReason: 'DESTINATION_UNAVAILABLE' })
        .where(eq(recoveryChallenges.id, challenge.id));
      return {
        ok: true,
        message: GENERIC_RECOVERY_MESSAGE,
        resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      };
    }

    const rawOtp = generateSixDigitOtp();
    const otpHmac = computeOtpHmac(challenge.id, 'PASSWORD_RESET', rawOtp);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);

    await db
      .update(recoveryChallenges)
      .set({
        otpHmac,
        expiresAt,
        failedAttempts: 0,
        resendCount: challenge.resendCount + 1,
        lastSentAt: now,
        resendAvailableAt,
      })
      .where(eq(recoveryChallenges.id, challenge.id));

    const delivery =
      challenge.channel === 'EMAIL'
        ? await resolveEmailDeliveryProvider().send({
            to: user.email,
            purpose: 'PASSWORD_RESET_OTP',
            subject: 'Your FortiX password reset verification code',
            codeOrToken: rawOtp,
            expiresAt,
          })
        : await resolveSmsDeliveryProvider().send({
            toPhoneE164: user.phoneE164!,
            purpose: 'PASSWORD_RESET_OTP',
            otpCode: rawOtp,
            expiresAt,
          });

    if (!delivery.delivered) {
      await db
        .update(recoveryChallenges)
        .set({
          invalidatedAt: new Date(),
          invalidationReason: delivery.errorCode || 'DELIVERY_FAILED',
        })
        .where(eq(recoveryChallenges.id, challenge.id));

      return {
        ok: false,
        status: 503,
        error: 'Unable to deliver verification code right now. Please try again later.',
        code: 'OTP_DELIVERY_FAILED',
      };
    }

    const exposeDevOtp =
      delivery.provider === 'dev-sandbox-outbox' &&
      process.env.NODE_ENV !== 'production' &&
      process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false';

    return {
      ok: true,
      message: GENERIC_RECOVERY_MESSAGE,
      resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      ...(exposeDevOtp ? { devOtpCode: rawOtp } : {}),
    };
  });
}

export async function verifyPasswordRecoveryOtp(params: {
  challengeId: string;
  otp: string;
  ip?: string;
}): Promise<
  | { ok: true; resetAuthorization: string; expiresInSeconds: number }
  | { ok: false; status: number; error: string; code: string; remainingAttempts?: number }
> {
  const rl = await checkMultiDimensionalOtpRateLimit({
    ip: params.ip,
    challengeId: params.challengeId,
    action: 'verify',
  });
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many verification attempts. Please wait before trying again.',
      code: 'OTP_VERIFY_RATE_LIMITED',
    };
  }

  const normalizedOtp = (params.otp || '').trim();
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return {
      ok: false,
      status: 400,
      error: 'Enter the 6-digit verification code.',
      code: 'INVALID_OTP_FORMAT',
    };
  }

  // Constant-work verification rejection for synthetic (unknown-account / unverified-phone) challenges
  if (isSyntheticChallengeId(params.challengeId)) {
    const candidateHmac = computeOtpHmac(params.challengeId, 'PASSWORD_RESET', normalizedOtp);
    const dummyHmac = computeOtpHmac(params.challengeId, 'PASSWORD_RESET', '000000');
    timingSafeHexEqual(candidateHmac, dummyHmac);
    return {
      ok: false,
      status: 400,
      error: 'Invalid or expired verification code.',
      code: 'INVALID_OTP',
    };
  }

  return withChallengeLock(params.challengeId, async () => {
    const [challenge] = await db
      .select()
      .from(recoveryChallenges)
      .where(
        and(
          eq(recoveryChallenges.id, params.challengeId),
          eq(recoveryChallenges.purpose, 'PASSWORD_RESET')
        )
      )
      .limit(1);

    if (!challenge) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid or expired verification code.',
        code: 'INVALID_OTP',
      };
    }

    const now = new Date();
    if (challenge.consumedAt) {
      return {
        ok: false,
        status: 400,
        error: 'This verification code has already been used.',
        code: 'OTP_ALREADY_USED',
      };
    }

    if (challenge.invalidatedAt || challenge.failedAttempts >= challenge.maxAttempts) {
      return {
        ok: false,
        status: 400,
        error: 'Maximum verification attempts exceeded or code invalidated. Request a new code.',
        code: 'OTP_ATTEMPTS_EXCEEDED',
      };
    }

    if (new Date(challenge.expiresAt).getTime() <= now.getTime()) {
      return {
        ok: false,
        status: 400,
        error: 'Verification code has expired. Request a new code.',
        code: 'OTP_EXPIRED',
      };
    }

    const expectedHmac = computeOtpHmac(challenge.id, 'PASSWORD_RESET', normalizedOtp);
    const matches = timingSafeHexEqual(expectedHmac, challenge.otpHmac);

    if (!matches) {
      const nextAttempts = challenge.failedAttempts + 1;
      const exhausted = nextAttempts >= challenge.maxAttempts;
      await db
        .update(recoveryChallenges)
        .set({
          failedAttempts: nextAttempts,
          ...(exhausted
            ? { invalidatedAt: now, invalidationReason: 'MAX_ATTEMPTS_EXCEEDED' }
            : {}),
        })
        .where(eq(recoveryChallenges.id, challenge.id));

      logger.warn(
        {
          event: 'auth.recovery.otp_failed',
          failedAttempts: nextAttempts,
          exhausted,
        },
        '[AuthRecovery] Failed OTP verification attempt'
      );

      if (exhausted) {
        return {
          ok: false,
          status: 400,
          error: 'Too many incorrect verification attempts. Request a new code.',
          code: 'OTP_ATTEMPTS_EXCEEDED',
          remainingAttempts: 0,
        };
      }

      return {
        ok: false,
        status: 400,
        error: 'Invalid or expired verification code.',
        code: 'INVALID_OTP',
        remainingAttempts: Math.max(0, challenge.maxAttempts - nextAttempts),
      };
    }

    // Atomic conditional transition: consumed_at NULL -> NOW while within attempts & expiry
    const updatedRows = await db
      .update(recoveryChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(recoveryChallenges.id, challenge.id),
          isNull(recoveryChallenges.consumedAt),
          isNull(recoveryChallenges.invalidatedAt),
          lt(recoveryChallenges.failedAttempts, challenge.maxAttempts),
          gt(recoveryChallenges.expiresAt, now)
        )
      )
      .returning({ id: recoveryChallenges.id, userId: recoveryChallenges.userId });

    if (updatedRows.length !== 1) {
      return {
        ok: false,
        status: 400,
        error: 'This verification code has already been used.',
        code: 'OTP_ALREADY_USED',
      };
    }

    const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid or expired verification code.',
        code: 'INVALID_OTP',
      };
    }

    const issuedAuth = await issueAuthActionToken(
      user.id,
      user.email,
      'RESET_AUTHORIZATION',
      10 * 60 * 1000,
      { skipDelivery: true }
    );

    logger.info(
      { event: 'auth.recovery.otp_verified', userId: user.id },
      '[AuthRecovery] OTP verified; issued short-lived single-use reset authorization'
    );

    return {
      ok: true,
      resetAuthorization: issuedAuth.rawToken,
      expiresInSeconds: 600,
    };
  });
}

export async function requestPhoneEnrollmentOtp(params: {
  userId: string;
  phoneInput: string;
  ip?: string;
}): Promise<
  | { ok: true; challengeId: string; phoneE164: string; destinationMasked: string; expiresInSeconds: number; devOtpCode?: string }
  | { ok: false; status: number; error: string; code: string }
> {
  const normalizedPhone = normalizePhoneE164(params.phoneInput);
  if (!normalizedPhone) {
    return {
      ok: false,
      status: 400,
      error: 'Phone number must use E.164 format (for example, +919876543210).',
      code: 'INVALID_PHONE_FORMAT',
    };
  }

  const rl = await checkMultiDimensionalOtpRateLimit({
    identifierNormalized: normalizedPhone,
    ip: params.ip,
    channel: 'SMS',
    action: 'request',
  });
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many phone verification requests. Please wait before retrying.',
      code: 'PHONE_RATE_LIMITED',
    };
  }

  // Ensure no other user owns this phone number
  const [existingPhoneOwner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneE164, normalizedPhone))
    .limit(1);

  if (existingPhoneOwner && existingPhoneOwner.id !== params.userId) {
    return {
      ok: false,
      status: 409,
      error: 'This phone number is already associated with another account.',
      code: 'PHONE_ALREADY_IN_USE',
    };
  }

  // Persist phoneE164 as unverified until OTP is confirmed
  await db
    .update(users)
    .set({ phoneE164: normalizedPhone, phoneVerified: false })
    .where(eq(users.id, params.userId));

  await invalidateUserRecoveryChallenges(params.userId, 'PHONE_VERIFICATION', 'NEW_PHONE_VERIFY_REQUESTED');

  const challengeId = uuidv4();
  const rawOtp = generateSixDigitOtp();
  const otpHmac = computeOtpHmac(challengeId, 'PHONE_VERIFICATION', rawOtp);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);
  const masked = maskPhoneE164(normalizedPhone);

  await db.insert(recoveryChallenges).values({
    id: challengeId,
    userId: params.userId,
    channel: 'SMS',
    purpose: 'PHONE_VERIFICATION',
    destinationMasked: masked,
    otpHmac,
    expiresAt,
    failedAttempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    resendCount: 0,
    lastSentAt: now,
    resendAvailableAt,
  });

  const delivery = await resolveSmsDeliveryProvider().send({
    toPhoneE164: normalizedPhone,
    purpose: 'PHONE_VERIFICATION_OTP',
    otpCode: rawOtp,
    expiresAt,
  });

  if (!delivery.delivered) {
    await db
      .update(recoveryChallenges)
      .set({
        invalidatedAt: new Date(),
        invalidationReason: delivery.errorCode || 'DELIVERY_FAILED',
      })
      .where(eq(recoveryChallenges.id, challengeId));

    return {
      ok: false,
      status: 503,
      error: 'SMS verification provider is unavailable or unconfigured.',
      code: 'SMS_DELIVERY_FAILED',
    };
  }

  const exposeDevOtp =
    delivery.provider === 'dev-sandbox-outbox' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false';

  return {
    ok: true,
    challengeId,
    phoneE164: normalizedPhone,
    destinationMasked: masked,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    ...(exposeDevOtp ? { devOtpCode: rawOtp } : {}),
  };
}

export async function confirmPhoneEnrollmentOtp(params: {
  userId: string;
  challengeId: string;
  otp: string;
}): Promise<
  | { ok: true; phoneE164: string; phoneVerified: true }
  | { ok: false; status: number; error: string; code: string }
> {
  const normalizedOtp = (params.otp || '').trim();
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return {
      ok: false,
      status: 400,
      error: 'Enter the 6-digit SMS verification code.',
      code: 'INVALID_OTP_FORMAT',
    };
  }

  return withChallengeLock(params.challengeId, async () => {
    const [challenge] = await db
      .select()
      .from(recoveryChallenges)
      .where(
        and(
          eq(recoveryChallenges.id, params.challengeId),
          eq(recoveryChallenges.userId, params.userId),
          eq(recoveryChallenges.purpose, 'PHONE_VERIFICATION')
        )
      )
      .limit(1);

    const now = new Date();
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.invalidatedAt ||
      challenge.failedAttempts >= challenge.maxAttempts ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid or expired phone verification code.',
        code: 'INVALID_OTP',
      };
    }

    const expectedHmac = computeOtpHmac(challenge.id, 'PHONE_VERIFICATION', normalizedOtp);
    if (!timingSafeHexEqual(expectedHmac, challenge.otpHmac)) {
      const nextAttempts = challenge.failedAttempts + 1;
      await db
        .update(recoveryChallenges)
        .set({
          failedAttempts: nextAttempts,
          ...(nextAttempts >= challenge.maxAttempts
            ? { invalidatedAt: now, invalidationReason: 'MAX_ATTEMPTS_EXCEEDED' }
            : {}),
        })
        .where(eq(recoveryChallenges.id, challenge.id));

      return {
        ok: false,
        status: 400,
        error: 'Invalid or expired phone verification code.',
        code: 'INVALID_OTP',
      };
    }

    const consumed = await db
      .update(recoveryChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(recoveryChallenges.id, challenge.id),
          isNull(recoveryChallenges.consumedAt),
          isNull(recoveryChallenges.invalidatedAt),
          gt(recoveryChallenges.expiresAt, now)
        )
      )
      .returning({ id: recoveryChallenges.id });

    if (consumed.length !== 1) {
      return {
        ok: false,
        status: 400,
        error: 'Verification code has already been used.',
        code: 'OTP_ALREADY_USED',
      };
    }

    const [updatedUser] = await db
      .update(users)
      .set({ phoneVerified: true })
      .where(eq(users.id, params.userId))
      .returning({ phoneE164: users.phoneE164 });

    return {
      ok: true,
      phoneE164: updatedUser?.phoneE164 || '',
      phoneVerified: true,
    };
  });
}
