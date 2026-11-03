import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authActionTokens } from '../db/schema.js';
import {
  getLatestDevSandboxSecret,
  NotificationDeliveryResult,
  resolveEmailDeliveryProvider,
} from '../auth/providers.js';

export type AuthTokenPurpose = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION' | 'RESET_AUTHORIZATION';

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000; // 15 minutes
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_AUTHORIZATION_TTL_MS = 10 * 60 * 1000; // 10 minutes single-use post-OTP authorization

// Per-token-hash mutex prevents concurrent replay races across event-loop ticks
const inFlightConsumptionLocks = new Map<string, Promise<any>>();

export function hashActionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function issueAuthActionToken(
  userId: string,
  email: string,
  purpose: AuthTokenPurpose,
  customTtlMs?: number,
  options?: { skipDelivery?: boolean }
): Promise<{ rawToken: string; expiresAt: Date; delivery?: NotificationDeliveryResult }> {
  const ttlMs =
    typeof customTtlMs === 'number'
      ? customTtlMs
      : purpose === 'RESET_AUTHORIZATION'
        ? RESET_AUTHORIZATION_TTL_MS
        : purpose === 'PASSWORD_RESET'
          ? PASSWORD_RESET_TTL_MS
          : EMAIL_VERIFY_TTL_MS;

  // Invalidate any previous unused tokens for this user + purpose
  await db
    .update(authActionTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authActionTokens.userId, userId),
        eq(authActionTokens.purpose, purpose),
        isNull(authActionTokens.usedAt)
      )
    );

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashActionToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);
  const tokenId = uuidv4();

  await db.insert(authActionTokens).values({
    id: tokenId,
    userId,
    purpose,
    tokenHash,
    expiresAt,
  });

  if (options?.skipDelivery || purpose === 'RESET_AUTHORIZATION') {
    return { rawToken, expiresAt };
  }

  const provider = resolveEmailDeliveryProvider();
  const delivery = await provider.send({
    to: email,
    purpose,
    subject:
      purpose === 'EMAIL_VERIFICATION'
        ? 'Verify your FortiX account email'
        : 'FortiX password reset instructions',
    codeOrToken: rawToken,
    expiresAt,
  });

  // If external delivery failed (e.g., webhook HTTP 500 or unconfigured prod provider),
  // immediately mark the issued token used/invalidated so undelivered tokens never linger active.
  if (!delivery.delivered) {
    await db
      .update(authActionTokens)
      .set({ usedAt: new Date() })
      .where(eq(authActionTokens.id, tokenId));
  }

  return { rawToken, expiresAt, delivery };
}

export async function consumeAuthActionToken(
  rawToken: string,
  expectedPurpose: AuthTokenPurpose
): Promise<{ valid: boolean; userId?: string; reason?: string }> {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) {
    return { valid: false, reason: 'Invalid or expired token' };
  }

  const tokenHash = hashActionToken(rawToken.trim());
  const lockKey = `${expectedPurpose}:${tokenHash}`;

  const previous = inFlightConsumptionLocks.get(lockKey) ?? Promise.resolve();
  let releaseLock!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  inFlightConsumptionLocks.set(lockKey, previous.then(() => gate));

  await previous;
  try {
    const now = new Date();

    // Atomic conditional UPDATE ensures only a single caller can transition used_at from NULL -> timestamp
    const consumedRows = await db
      .update(authActionTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authActionTokens.tokenHash, tokenHash),
          eq(authActionTokens.purpose, expectedPurpose),
          isNull(authActionTokens.usedAt),
          gt(authActionTokens.expiresAt, now)
        )
      )
      .returning({ id: authActionTokens.id, userId: authActionTokens.userId });

    if (consumedRows.length === 1) {
      return { valid: true, userId: consumedRows[0].userId };
    }

    // Read-only diagnostic lookup to provide accurate rejection reason (expired vs already used vs unknown)
    const [existing] = await db
      .select({
        usedAt: authActionTokens.usedAt,
        expiresAt: authActionTokens.expiresAt,
      })
      .from(authActionTokens)
      .where(
        and(
          eq(authActionTokens.tokenHash, tokenHash),
          eq(authActionTokens.purpose, expectedPurpose)
        )
      )
      .limit(1);

    if (!existing) {
      return { valid: false, reason: 'Invalid or expired token' };
    }
    if (existing.usedAt !== null) {
      return { valid: false, reason: 'Token has already been used' };
    }
    if (new Date(existing.expiresAt).getTime() <= now.getTime()) {
      return { valid: false, reason: 'Token has expired' };
    }
    return { valid: false, reason: 'Invalid or expired token' };
  } finally {
    releaseLock();
    if (inFlightConsumptionLocks.get(lockKey) !== undefined) {
      // Clean up lock reference once settled
      Promise.resolve().then(() => {
        inFlightConsumptionLocks.delete(lockKey);
      });
    }
  }
}

export async function invalidateUserActionTokens(
  userId: string,
  purposes: AuthTokenPurpose[] = ['PASSWORD_RESET', 'RESET_AUTHORIZATION']
): Promise<void> {
  if (!userId || purposes.length === 0) return;
  await db
    .update(authActionTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authActionTokens.userId, userId),
        inArray(authActionTokens.purpose, purposes),
        isNull(authActionTokens.usedAt)
      )
    );
}

export function getLatestDevOutboxToken(email: string, purpose: AuthTokenPurpose): string | undefined {
  return getLatestDevSandboxSecret(email, purpose, 'EMAIL');
}
