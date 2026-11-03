import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index.js';
import { users, organizations, projects } from '../db/schema.js';
import {
  getJwtSecret,
  extractRequestToken,
  extractSessionFamilyFromJwt,
  revokeJwtToken,
  recordPasswordRotation,
  verifyAndResolveJwtUser,
} from '../lib/jwt-security.js';
import {
  REFRESH_COOKIE_NAME,
  getCookieValue,
  issueSessionCookie,
  issueRefreshCookie,
  issueCsrfCookie,
  clearSessionCookies,
} from '../lib/cors-csrf.js';
import {
  issueAuthActionToken,
  consumeAuthActionToken,
  invalidateUserActionTokens,
} from '../lib/auth-tokens.js';
import {
  createRefreshSession,
  rotateRefreshSession,
  revokeRefreshSessionByRawToken,
  revokeAllUserRefreshSessions,
  listActiveUserSessions,
  revokeUserSessionFamily,
  signAccessJwt,
} from '../auth/sessions.js';
import {
  normalizePhoneE164,
  parseLoginOrRecoveryIdentifier,
  requestPasswordRecoveryOtp,
  resendPasswordRecoveryOtp,
  verifyPasswordRecoveryOtp,
  invalidateUserRecoveryChallenges,
  requestPhoneEnrollmentOtp,
  confirmPhoneEnrollmentOtp,
} from '../auth/recovery.js';
import { disconnectSocketsForToken, disconnectSocketsForUser } from '../socket.js';
import { recordProductAnalyticsEvent } from '../lib/analytics.js';
import { logger } from '../lib/logger.js';

getJwtSecret();

const router = express.Router();

// Pre-computed dummy hash prevents timing side-channels when login identifier is not found
const DUMMY_BCRYPT_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8p3t6r5b2Q5P1N4hM8yG0rZ6vK9W2e';

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:
    process.env.NODE_ENV === 'production' || process.env.ENFORCE_AUTH_RATE_LIMIT === 'true'
      ? 25
      : 150,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () =>
    (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') &&
    process.env.ENFORCE_AUTH_RATE_LIMIT !== 'true',
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false,
    trustProxy: false,
  },
  message: { error: 'Too many authentication attempts. Please try again after 1 minute.' },
});

router.use(authLimiter);

// Strictly omit role from client registration payload; new registrants ALWAYS receive DEVELOPER
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(24).optional(),
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone } = registerSchema.parse(req.body);

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return res.status(409).json({ error: 'User already exists' });
    }

    let normalizedPhone: string | null = null;
    if (phone && phone.trim().length > 0) {
      normalizedPhone = normalizePhoneE164(phone);
      if (!normalizedPhone) {
        return res.status(400).json({
          error: 'Phone number must be formatted in E.164 format (e.g., +919876543210).',
        });
      }
      const [existingPhone] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phoneE164, normalizedPhone))
        .limit(1);
      if (existingPhone) {
        return res.status(409).json({ error: 'Phone number is already associated with an account' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [user] = await db
      .insert(users)
      .values({
        id: uuidv4(),
        email,
        phoneE164: normalizedPhone,
        phoneVerified: false,
        passwordHash,
        role: 'DEVELOPER',
        emailVerified: false,
      })
      .returning();

    // Provision default organization & starter project so newly registered operators have an active workspace immediately
    try {
      const orgId = uuidv4();
      await db.insert(organizations).values({
        id: orgId,
        name: name ? `${name}'s Organization` : 'Default Organization',
        ownerId: user.id,
      });
      await db.insert(projects).values({
        id: uuidv4(),
        orgId,
        name: 'Primary Gateway',
        environment: 'development',
      });
    } catch (workspaceErr) {
      logger.warn({ err: workspaceErr }, '[Auth] Default workspace provisioning warning');
    }

    let verificationPreviewToken: string | undefined;
    try {
      const issued = await issueAuthActionToken(user.id, user.email, 'EMAIL_VERIFICATION');
      if (
        issued.delivery?.delivered !== false &&
        process.env.NODE_ENV !== 'production' &&
        process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false'
      ) {
        verificationPreviewToken = issued.rawToken;
      }
    } catch (tokenErr) {
      logger.warn({ err: tokenErr }, '[Auth] Failed to issue initial email verification token');
    }

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        phoneE164: user.phoneE164 ?? null,
        phoneVerified: Boolean(user.phoneVerified),
        role: user.role,
        emailVerified: Boolean(user.emailVerified),
      },
      ...(verificationPreviewToken ? { devVerificationToken: verificationPreviewToken } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues });
    }
    logger.error({ err: error }, '[Auth] Register error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().optional().default(false),
  })
  .refine((val) => Boolean(val.identifier || val.email), {
    message: 'Email address or phone number is required',
  });

router.post('/login', async (req, res) => {
  try {
    const parsedBody = loginSchema.parse(req.body);
    const rawIdentifier = (parsedBody.identifier || parsedBody.email || '').trim();
    const rememberMe = Boolean(parsedBody.rememberMe);
    const parsedId = parseLoginOrRecoveryIdentifier(rawIdentifier);

    if (!parsedId) {
      return res.status(400).json({
        error: 'Enter a valid email address or E.164 phone number.',
      });
    }

    // Block demo credentials in production unless explicitly enabled
    const isDemoAccount =
      parsedId.kind === 'email' &&
      (parsedId.normalized === 'admin@fortix.test' || parsedId.normalized === 'admin@fortix.io');
    if (process.env.NODE_ENV === 'production' && isDemoAccount && process.env.ALLOW_DEMO_ACCOUNTS !== 'true') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const [user] =
      parsedId.kind === 'email'
        ? await db.select().from(users).where(eq(users.email, parsedId.normalized)).limit(1)
        : await db.select().from(users).where(eq(users.phoneE164, parsedId.normalized)).limit(1);

    // Phone login requires verified phone ownership to prevent unverified phone hijacking
    if (!user || (parsedId.kind === 'phone' && !user.phoneVerified)) {
      await bcrypt.compare(parsedBody.password, DUMMY_BCRYPT_HASH).catch(() => false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(parsedBody.password, user.passwordHash);
    if (!isValid) {
      logger.warn({ event: 'auth.login.failed', userId: user.id }, '[Auth] Invalid password login attempt');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const refreshSession = await createRefreshSession({
      userId: user.id,
      rememberMe,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      ip: req.ip,
    });

    const signedAccess = signAccessJwt({
      id: user.id,
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
      rememberMe,
      familyId: refreshSession.familyId,
    });

    // When rememberMe is true, cookies persist across browser restarts up to SESSION_REMEMBER_TTL_DAYS.
    // When rememberMe is false, cookies are session-scoped (cleared on browser close) and server-bounded by SESSION_SHORT_TTL_HOURS.
    issueSessionCookie(req, res, signedAccess.token, signedAccess.maxAgeMs, { persistent: rememberMe });
    issueRefreshCookie(req, res, refreshSession.rawRefreshToken, refreshSession.maxAgeMs, {
      persistent: rememberMe,
    });
    const csrfToken = issueCsrfCookie(req, res, refreshSession.maxAgeMs, { persistent: rememberMe });

    const isBrowserClient =
      String(req.headers['x-fortix-client'] || '').toLowerCase() === 'browser';

    logger.info(
      { event: 'auth.login.succeeded', userId: user.id, rememberMe },
      '[Auth] Operator authenticated'
    );

    res.json({
      ...(isBrowserClient ? { sessionMode: 'httpOnly-cookie' } : { token: signedAccess.token }),
      csrfToken,
      rememberMe,
      sessionFamilyId: refreshSession.familyId,
      user: {
        id: user.id,
        email: user.email,
        phoneE164: user.phoneE164 ?? null,
        phoneVerified: Boolean(user.phoneVerified),
        role: user.role,
        emailVerified: Boolean(user.emailVerified),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const rawRefreshToken =
      getCookieValue(req as any, REFRESH_COOKIE_NAME) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);

    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'No active refresh session', code: 'MISSING_REFRESH_TOKEN' });
    }

    const rotated = await rotateRefreshSession({
      rawRefreshToken,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      ip: req.ip,
    });

    if ('reason' in rotated) {
      if (rotated.reuseDetected && rotated.userId) {
        disconnectSocketsForUser(rotated.userId);
      }
      clearSessionCookies(req, res);
      return res.status(401).json({ error: rotated.reason, code: rotated.code });
    }

    issueSessionCookie(req, res, rotated.accessJwt, rotated.accessMaxAgeMs, {
      persistent: rotated.rememberMe,
    });
    issueRefreshCookie(req, res, rotated.rawRefreshToken, rotated.refreshMaxAgeMs, {
      persistent: rotated.rememberMe,
    });
    const csrfToken = issueCsrfCookie(req, res, rotated.refreshMaxAgeMs, {
      persistent: rotated.rememberMe,
    });

    const isBrowserClient =
      String(req.headers['x-fortix-client'] || '').toLowerCase() === 'browser';

    res.status(200).json({
      refreshed: true,
      rememberMe: rotated.rememberMe,
      sessionFamilyId: rotated.familyId,
      csrfToken,
      user: rotated.user,
      ...(isBrowserClient ? {} : { token: rotated.accessJwt }),
    });
  } catch {
    clearSessionCookies(req, res);
    res.status(401).json({ error: 'Session refresh failed', code: 'REFRESH_FAILED' });
  }
});

router.post('/logout', async (req, res) => {
  const token = extractRequestToken(req);
  if (token) {
    await revokeJwtToken(token);
    disconnectSocketsForToken(token);
  }
  const refreshCookie = getCookieValue(req as any, REFRESH_COOKIE_NAME);
  if (refreshCookie) {
    await revokeRefreshSessionByRawToken(refreshCookie);
  }
  clearSessionCookies(req, res);
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', async (req, res) => {
  try {
    const token = extractRequestToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const user = await verifyAndResolveJwtUser(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const csrfToken = issueCsrfCookie(req, res);
    res.json({ user, csrfToken });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const token = extractRequestToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const user = await verifyAndResolveJwtUser(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const currentRefresh = getCookieValue(req as any, REFRESH_COOKIE_NAME);
    const currentSid = extractSessionFamilyFromJwt(token);
    const sessions = await listActiveUserSessions(user.id, currentRefresh, currentSid);
    res.status(200).json({ sessions });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions/:familyId', async (req, res) => {
  try {
    const token = extractRequestToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const user = await verifyAndResolveJwtUser(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const familyId = String(req.params.familyId || '').trim();
    if (!familyId) {
      return res.status(400).json({ error: 'Session identifier is required' });
    }

    const currentRefresh = getCookieValue(req as any, REFRESH_COOKIE_NAME);
    const currentSid = extractSessionFamilyFromJwt(token);
    const sessionsBefore = await listActiveUserSessions(user.id, currentRefresh, currentSid);
    const targetSession = sessionsBefore.find((s) => s.familyId === familyId);

    const revoked = await revokeUserSessionFamily(user.id, familyId);
    if (!revoked) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    if (targetSession?.isCurrent) {
      await revokeJwtToken(token);
      disconnectSocketsForToken(token);
      clearSessionCookies(req, res);
    }

    logger.info(
      { event: 'auth.session.revoked', userId: user.id, familyId },
      '[Auth] Operator revoked active session family'
    );

    res.status(200).json({
      revoked: true,
      revokedCurrentSession: Boolean(targetSession?.isCurrent),
      message: 'Session revoked successfully.',
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const forgotPasswordSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
  })
  .refine((v) => Boolean(v.identifier || v.email), {
    message: 'Email address or phone number is required',
  });

router.post('/forgot-password', async (req, res) => {
  try {
    const parsedBody = forgotPasswordSchema.parse(req.body);
    const rawIdentifier = (parsedBody.identifier || parsedBody.email || '').trim();

    const otpOutcome = await requestPasswordRecoveryOtp({
      identifier: rawIdentifier,
      ip: req.ip,
    });

    if ('error' in otpOutcome) {
      return res.status(otpOutcome.status).json({
        error: otpOutcome.error,
        code: otpOutcome.code,
      });
    }

    // Preserve backward compatibility for programmatic callers passing legacy `{ email }`
    let devResetToken: string | undefined;
    if (!parsedBody.identifier && parsedBody.email && rawIdentifier.includes('@')) {
      const normalizedEmail = rawIdentifier.toLowerCase();
      const [legacyUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (legacyUser) {
        const issued = await issueAuthActionToken(legacyUser.id, legacyUser.email, 'PASSWORD_RESET');
        if (
          issued.delivery?.delivered !== false &&
          process.env.NODE_ENV !== 'production' &&
          process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false'
        ) {
          devResetToken = issued.rawToken;
        }
      }
    }

    res.status(200).json({
      message: otpOutcome.data.genericMessage,
      challengeId: otpOutcome.data.challengeId,
      channel: otpOutcome.data.channel,
      destinationMasked: otpOutcome.data.destinationMasked,
      expiresInSeconds: otpOutcome.data.expiresInSeconds,
      resendCooldownSeconds: otpOutcome.data.resendCooldownSeconds,
      ...(otpOutcome.data.devOtpCode ? { devOtpCode: otpOutcome.data.devOtpCode } : {}),
      ...(devResetToken ? { devResetToken } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Enter a valid email address or phone number.',
        details: error.issues,
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const resendOtpSchema = z.object({
  challengeId: z.string().trim().min(16).max(64),
});

router.post('/resend-reset-otp', async (req, res) => {
  try {
    const { challengeId } = resendOtpSchema.parse(req.body);
    const outcome = await resendPasswordRecoveryOtp({
      challengeId,
      ip: req.ip,
    });
    if ('error' in outcome) {
      return res.status(outcome.status).json({
        error: outcome.error,
        code: outcome.code,
        ...(outcome.retryAfterSeconds ? { retryAfterSeconds: outcome.retryAfterSeconds } : {}),
      });
    }
    res.status(200).json({
      message: outcome.message,
      resendCooldownSeconds: outcome.resendCooldownSeconds,
      expiresInSeconds: outcome.expiresInSeconds,
      ...(outcome.devOtpCode ? { devOtpCode: outcome.devOtpCode } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid resend request', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const verifyOtpSchema = z.object({
  challengeId: z.string().trim().min(16).max(64),
  otp: z.string().trim().min(4).max(12),
});

router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { challengeId, otp } = verifyOtpSchema.parse(req.body);
    const outcome = await verifyPasswordRecoveryOtp({
      challengeId,
      otp,
      ip: req.ip,
    });
    if ('error' in outcome) {
      return res.status(outcome.status).json({
        error: outcome.error,
        code: outcome.code,
        ...(typeof outcome.remainingAttempts === 'number'
          ? { remainingAttempts: outcome.remainingAttempts }
          : {}),
      });
    }

    res.status(200).json({
      verified: true,
      resetAuthorization: outcome.resetAuthorization,
      expiresInSeconds: outcome.expiresInSeconds,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Enter a valid 6-digit verification code.', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const resetPasswordSchema = z
  .object({
    resetAuthorization: z.string().trim().min(32).max(256).optional(),
    token: z.string().trim().min(32).max(256).optional(),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(1).max(128).optional(),
  })
  .refine((v) => Boolean(v.resetAuthorization || v.token), {
    message: 'Reset authorization token is required',
  });

router.post('/reset-password', async (req, res) => {
  try {
    const parsed = resetPasswordSchema.parse(req.body);

    // Server-side password confirmation enforcement:
    // Required when using the OTP `resetAuthorization` flow, and enforced whenever `confirmPassword` is supplied.
    if (parsed.resetAuthorization && parsed.confirmPassword === undefined) {
      return res.status(400).json({
        error: 'Password confirmation is required.',
        code: 'PASSWORD_CONFIRMATION_REQUIRED',
      });
    }
    if (parsed.confirmPassword !== undefined && parsed.newPassword !== parsed.confirmPassword) {
      return res.status(400).json({
        error: 'New password and confirmation password do not match.',
        code: 'PASSWORD_MISMATCH',
      });
    }

    const expectedPurpose = parsed.resetAuthorization ? 'RESET_AUTHORIZATION' : 'PASSWORD_RESET';
    const rawCredential = (parsed.resetAuthorization || parsed.token)!;

    const consumed = await consumeAuthActionToken(rawCredential, expectedPurpose);
    if (!consumed.valid || !consumed.userId) {
      return res.status(400).json({
        error: consumed.reason || 'Invalid or expired reset authorization',
        code: 'INVALID_RESET_TOKEN',
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, consumed.userId)).limit(1);
    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired reset authorization',
        code: 'INVALID_RESET_TOKEN',
      });
    }

    const newHash = await bcrypt.hash(parsed.newPassword, 10);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

    // Invalidate all outstanding reset tokens, OTP challenges, refresh token families, JWTs, and WebSockets
    await Promise.all([
      recordPasswordRotation(user.id, newHash),
      revokeAllUserRefreshSessions(user.id),
      invalidateUserActionTokens(user.id, ['PASSWORD_RESET', 'RESET_AUTHORIZATION']),
      invalidateUserRecoveryChallenges(user.id, 'PASSWORD_RESET', 'PASSWORD_RESET_COMPLETED'),
    ]);

    disconnectSocketsForUser(user.id);
    clearSessionCookies(req, res);

    logger.info(
      { event: 'auth.recovery.password_reset_completed', userId: user.id },
      '[Auth] Account password reset completed; all existing sessions revoked'
    );

    res.status(200).json({
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid password reset request', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const phoneRequestSchema = z.object({
  phone: z.string().trim().min(7).max(24),
});

router.post('/phone/request-verify', async (req, res) => {
  try {
    const sessionToken = extractRequestToken(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    const sessionUser = await verifyAndResolveJwtUser(sessionToken);
    if (!sessionUser) return res.status(401).json({ error: 'Unauthorized' });

    const { phone } = phoneRequestSchema.parse(req.body);
    const outcome = await requestPhoneEnrollmentOtp({
      userId: sessionUser.id,
      phoneInput: phone,
      ip: req.ip,
    });
    if ('error' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    }

    res.status(200).json({
      message: `Verification code sent to ${outcome.destinationMasked}.`,
      challengeId: outcome.challengeId,
      phoneE164: outcome.phoneE164,
      destinationMasked: outcome.destinationMasked,
      expiresInSeconds: outcome.expiresInSeconds,
      ...(outcome.devOtpCode ? { devOtpCode: outcome.devOtpCode } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Enter a valid E.164 phone number.', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const phoneConfirmSchema = z.object({
  challengeId: z.string().trim().min(16).max(64),
  otp: z.string().trim().min(4).max(12),
});

router.post('/phone/confirm-verify', async (req, res) => {
  try {
    const sessionToken = extractRequestToken(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    const sessionUser = await verifyAndResolveJwtUser(sessionToken);
    if (!sessionUser) return res.status(401).json({ error: 'Unauthorized' });

    const { challengeId, otp } = phoneConfirmSchema.parse(req.body);
    const outcome = await confirmPhoneEnrollmentOtp({
      userId: sessionUser.id,
      challengeId,
      otp,
    });
    if ('error' in outcome) {
      return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    }

    res.status(200).json({
      verified: true,
      phoneE164: outcome.phoneE164,
      phoneVerified: true,
      message: 'Phone number verified successfully.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Enter a valid 6-digit verification code.', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

const verifyEmailSchema = z.object({
  token: z.string().trim().min(32).max(256),
});

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const consumed = await consumeAuthActionToken(token, 'EMAIL_VERIFICATION');
    if (!consumed.valid || !consumed.userId) {
      return res.status(400).json({
        error: consumed.reason || 'Invalid or expired token',
        code: 'INVALID_VERIFICATION_TOKEN',
      });
    }

    await db.update(users).set({ emailVerified: true }).where(eq(users.id, consumed.userId));
    recordProductAnalyticsEvent({
      event: 'account_email_verified',
      optOut: req.headers['x-fortix-analytics-opt-out'] === 'true',
    });
    res.status(200).json({ verified: true, message: 'Email address verified successfully.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid verification token', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const sessionToken = extractRequestToken(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });

    const sessionUser = await verifyAndResolveJwtUser(sessionToken);
    if (!sessionUser) return res.status(401).json({ error: 'Unauthorized' });

    if (sessionUser.emailVerified) {
      return res.status(200).json({ message: 'Email is already verified.' });
    }

    const issued = await issueAuthActionToken(sessionUser.id, sessionUser.email, 'EMAIL_VERIFICATION');
    if (issued.delivery?.delivered === false) {
      return res.status(503).json({
        error: 'Email verification delivery provider is currently unavailable.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    res.status(200).json({
      message: 'Verification token dispatched.',
      ...(process.env.NODE_ENV !== 'production' && process.env.EXPOSE_DEV_AUTH_TOKENS !== 'false'
        ? { devVerificationToken: issued.rawToken }
        : {}),
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const authRouter = router;
