import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { refreshTokens, users } from '../db/schema.js';
import { computePasswordVersion, getJwtSecret, revokeSessionFamilySid } from '../lib/jwt-security.js';
import { logger } from '../lib/logger.js';

const DEFAULT_SHORT_SESSION_HOURS = 12;
const DEFAULT_REMEMBER_SESSION_DAYS = 30;
const ACCESS_JWT_REMEMBER_TTL_SEC = 60 * 60; // 1 hour access token rotated via persistent refresh cookie

const refreshRotationLocks = new Map<string, Promise<any>>();

export function getShortSessionTtlMs(): number {
  const parsed = Number.parseInt(process.env.SESSION_SHORT_TTL_HOURS || '', 10);
  const hours = Number.isFinite(parsed) && parsed >= 1 && parsed <= 48 ? parsed : DEFAULT_SHORT_SESSION_HOURS;
  return hours * 60 * 60 * 1000;
}

export function getRememberSessionTtlMs(): number {
  const parsed = Number.parseInt(process.env.SESSION_REMEMBER_TTL_DAYS || '', 10);
  const days = Number.isFinite(parsed) && parsed >= 1 && parsed <= 90 ? parsed : DEFAULT_REMEMBER_SESSION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function hashClientMetadata(value?: string): string | null {
  if (!value || typeof value !== 'string' || !value.trim()) return null;
  return crypto.createHash('sha256').update(value.trim()).digest('hex').slice(0, 24);
}

export function signAccessJwt(params: {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
  rememberMe: boolean;
  familyId?: string;
}): { token: string; maxAgeMs: number } {
  const shortTtlMs = getShortSessionTtlMs();
  const expiresInSeconds = params.rememberMe
    ? ACCESS_JWT_REMEMBER_TTL_SEC
    : Math.floor(shortTtlMs / 1000);

  const token = jwt.sign(
    {
      id: params.id,
      email: params.email,
      role: params.role,
      pwdVer: computePasswordVersion(params.passwordHash),
      sid: params.familyId,
      jti: uuidv4(),
    },
    getJwtSecret(),
    {
      expiresIn: expiresInSeconds,
      algorithm: 'HS256',
    }
  );

  return { token, maxAgeMs: expiresInSeconds * 1000 };
}

export async function createRefreshSession(params: {
  userId: string;
  rememberMe: boolean;
  userAgent?: string;
  ip?: string;
}): Promise<{
  rawRefreshToken: string;
  familyId: string;
  expiresAt: Date;
  maxAgeMs: number;
  rememberMe: boolean;
}> {
  const rawRefreshToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const familyId = uuidv4();
  const maxAgeMs = params.rememberMe ? getRememberSessionTtlMs() : getShortSessionTtlMs();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAgeMs);

  await db.insert(refreshTokens).values({
    id: uuidv4(),
    userId: params.userId,
    tokenHash,
    familyId,
    rememberMe: params.rememberMe,
    expiresAt,
    absoluteExpiresAt: expiresAt,
    lastUsedAt: now,
    userAgentHash: hashClientMetadata(params.userAgent),
    ipHash: hashClientMetadata(params.ip),
  });

  return {
    rawRefreshToken,
    familyId,
    expiresAt,
    maxAgeMs,
    rememberMe: params.rememberMe,
  };
}

export async function rotateRefreshSession(params: {
  rawRefreshToken: string;
  userAgent?: string;
  ip?: string;
}): Promise<
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        role: string;
        emailVerified: boolean;
        phoneE164: string | null;
        phoneVerified: boolean;
      };
      accessJwt: string;
      accessMaxAgeMs: number;
      rawRefreshToken: string;
      refreshMaxAgeMs: number;
      rememberMe: boolean;
      familyId: string;
    }
  | { ok: false; reason: string; code: string; reuseDetected?: boolean; userId?: string }
> {
  if (!params.rawRefreshToken || typeof params.rawRefreshToken !== 'string' || params.rawRefreshToken.length < 32) {
    return { ok: false, reason: 'Invalid refresh session', code: 'INVALID_REFRESH_TOKEN' };
  }

  const tokenHash = hashRefreshToken(params.rawRefreshToken.trim());

  const prev = refreshRotationLocks.get(tokenHash) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  refreshRotationLocks.set(tokenHash, prev.then(() => gate));

  await prev;
  try {
    const [existing] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!existing) {
      return { ok: false, reason: 'Invalid refresh session', code: 'INVALID_REFRESH_TOKEN' };
    }

    const now = new Date();
    const familyId = existing.familyId || existing.id;

    // Replay / Reuse Detection:
    // If this refresh token was already rotated (`replacedById` set) or explicitly revoked,
    // revoke the ENTIRE token family immediately to terminate both attacker and compromised client chains.
    if (existing.replacedById !== null || existing.revokedAt !== null) {
      await db
        .update(refreshTokens)
        .set({
          revokedAt: now,
          reuseDetectedAt: now,
        })
        .where(
          and(
            eq(refreshTokens.familyId, familyId),
            isNull(refreshTokens.revokedAt)
          )
        );

      await revokeSessionFamilySid(familyId);

      logger.warn(
        {
          event: 'auth.session.refresh_reuse_detected',
          userId: existing.userId,
          familyId,
        },
        '[AuthSessions] Refresh token reuse detected; revoked entire session family'
      );

      return {
        ok: false,
        reason: 'Session invalidated due to refresh token reuse detection.',
        code: 'REFRESH_TOKEN_REUSED',
        reuseDetected: true,
        userId: existing.userId,
      };
    }

    const absoluteExp = existing.absoluteExpiresAt
      ? new Date(existing.absoluteExpiresAt)
      : new Date(existing.expiresAt);

    if (
      new Date(existing.expiresAt).getTime() <= now.getTime() ||
      absoluteExp.getTime() <= now.getTime()
    ) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(eq(refreshTokens.id, existing.id));
      return { ok: false, reason: 'Session has expired', code: 'REFRESH_TOKEN_EXPIRED' };
    }

    const [user] = await db.select().from(users).where(eq(users.id, existing.userId)).limit(1);
    if (!user) {
      return { ok: false, reason: 'Account not found', code: 'INVALID_REFRESH_TOKEN' };
    }

    const newRowId = uuidv4();
    const nextRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const nextTokenHash = hashRefreshToken(nextRawRefreshToken);
    const baseTtlMs = existing.rememberMe ? getRememberSessionTtlMs() : getShortSessionTtlMs();
    const cappedExpiresAt = new Date(
      Math.min(now.getTime() + baseTtlMs, absoluteExp.getTime())
    );
    const refreshMaxAgeMs = Math.max(1000, cappedExpiresAt.getTime() - now.getTime());

    // Atomic conditional rotation update
    const rotated = await db
      .update(refreshTokens)
      .set({
        revokedAt: now,
        replacedById: newRowId,
        lastUsedAt: now,
      })
      .where(
        and(
          eq(refreshTokens.id, existing.id),
          isNull(refreshTokens.revokedAt),
          isNull(refreshTokens.replacedById)
        )
      )
      .returning({ id: refreshTokens.id });

    if (rotated.length !== 1) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now, reuseDetectedAt: now })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
      await revokeSessionFamilySid(familyId);
      return {
        ok: false,
        reason: 'Session invalidated due to concurrent refresh token replay.',
        code: 'REFRESH_TOKEN_REUSED',
        reuseDetected: true,
        userId: existing.userId,
      };
    }

    await db.insert(refreshTokens).values({
      id: newRowId,
      userId: user.id,
      tokenHash: nextTokenHash,
      familyId,
      rememberMe: existing.rememberMe,
      expiresAt: cappedExpiresAt,
      absoluteExpiresAt: absoluteExp,
      lastUsedAt: now,
      userAgentHash: hashClientMetadata(params.userAgent) ?? existing.userAgentHash,
      ipHash: hashClientMetadata(params.ip) ?? existing.ipHash,
    });

    const signed = signAccessJwt({
      id: user.id,
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
      rememberMe: existing.rememberMe,
      familyId,
    });

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerified),
        phoneE164: user.phoneE164 ?? null,
        phoneVerified: Boolean(user.phoneVerified),
      },
      accessJwt: signed.token,
      accessMaxAgeMs: signed.maxAgeMs,
      rawRefreshToken: nextRawRefreshToken,
      refreshMaxAgeMs,
      rememberMe: existing.rememberMe,
      familyId,
    };
  } finally {
    release();
    Promise.resolve().then(() => {
      refreshRotationLocks.delete(tokenHash);
    });
  }
}

export async function revokeRefreshSessionByRawToken(rawRefreshToken?: string): Promise<void> {
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') return;
  const tokenHash = hashRefreshToken(rawRefreshToken.trim());
  const [existing] = await db
    .select({ id: refreshTokens.id, familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!existing) return;
  const now = new Date();
  if (existing.familyId) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, existing.familyId), isNull(refreshTokens.revokedAt)));
    await revokeSessionFamilySid(existing.familyId);
  } else {
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(eq(refreshTokens.id, existing.id));
  }
}

export async function revokeAllUserRefreshSessions(userId: string): Promise<void> {
  if (!userId) return;
  const active = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  for (const row of active) {
    if (row.familyId) {
      await revokeSessionFamilySid(row.familyId);
    }
  }
}

export async function listActiveUserSessions(
  userId: string,
  currentRawRefreshToken?: string,
  currentFamilyId?: string
): Promise<
  Array<{
    familyId: string;
    rememberMe: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date;
    isCurrent: boolean;
  }>
> {
  const now = new Date();
  const currentHash = currentRawRefreshToken ? hashRefreshToken(currentRawRefreshToken.trim()) : null;

  const activeRows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        isNull(refreshTokens.replacedById),
        gt(refreshTokens.expiresAt, now)
      )
    )
    .orderBy(desc(refreshTokens.createdAt));

  return activeRows.map((row) => {
    const resolvedFamilyId = row.familyId || row.id;
    return {
      familyId: resolvedFamilyId,
      rememberMe: Boolean(row.rememberMe),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      isCurrent:
        (currentHash !== null && row.tokenHash === currentHash) ||
        (Boolean(currentFamilyId) && resolvedFamilyId === currentFamilyId),
    };
  });
}

export async function revokeUserSessionFamily(userId: string, familyId: string): Promise<boolean> {
  if (!userId || !familyId) return false;
  const now = new Date();
  const byFamily = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.revokedAt)
      )
    )
    .returning({ id: refreshTokens.id });

  if (byFamily.length > 0) {
    await revokeSessionFamilySid(familyId);
    return true;
  }

  const byId = await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.id, familyId),
        isNull(refreshTokens.revokedAt)
      )
    )
    .returning({ id: refreshTokens.id });

  if (byId.length > 0) {
    await revokeSessionFamilySid(familyId);
    return true;
  }
  return false;
}
