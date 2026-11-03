import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setupApiRoutes } from '../../src/api/index.js';
import { db } from '../../src/db/index.js';
import {
  users,
  recoveryChallenges,
  refreshTokens,
  authActionTokens,
} from '../../src/db/schema.js';
import {
  issueAuthActionToken,
  consumeAuthActionToken,
} from '../../src/lib/auth-tokens.js';
import {
  WebhookEmailDeliveryProvider,
  setAuthDeliveryProviderOverridesForTests,
  __clearDevSandboxOutboxForTests,
  SmsMessagePayload,
} from '../../src/auth/providers.js';
import { computeOtpHmac } from '../../src/auth/recovery.js';

describe('FTX-AUTH-001: Authentication, Remember-Me Sessions & Account Recovery', () => {
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  const createdUserIds: string[] = [];

  beforeEach(() => {
    __clearDevSandboxOutboxForTests();
    setAuthDeliveryProviderOverridesForTests({ email: null, sms: null });
  });

  afterEach(async () => {
    setAuthDeliveryProviderOverridesForTests({ email: null, sms: null });
    while (createdUserIds.length > 0) {
      const uid = createdUserIds.pop();
      if (uid) {
        await db.delete(users).where(eq(users.id, uid)).catch(() => {});
      }
    }
  });

  it('001A: allows multiple null phone_e164 users, rejects duplicate E.164 phones, and defaults phoneVerified to false', async () => {
    const u1 = await request(app)
      .post('/api/auth/register')
      .send({ email: `nullphone1-${Date.now()}@fortix.test`, password: 'StrongPassword!123' });
    const u2 = await request(app)
      .post('/api/auth/register')
      .send({ email: `nullphone2-${Date.now()}@fortix.test`, password: 'StrongPassword!123' });

    expect(u1.status).toBe(201);
    expect(u2.status).toBe(201);
    createdUserIds.push(u1.body.user.id, u2.body.user.id);
    expect(u1.body.user.phoneE164).toBeNull();
    expect(u2.body.user.phoneE164).toBeNull();
    expect(u1.body.user.phoneVerified).toBe(false);

    const uniqueDigits = String(Date.now()).slice(-9);
    const phone = `+919${uniqueDigits}`;

    const u3 = await request(app)
      .post('/api/auth/register')
      .send({
        email: `withphone1-${Date.now()}@fortix.test`,
        password: 'StrongPassword!123',
        phone,
      });
    expect(u3.status).toBe(201);
    createdUserIds.push(u3.body.user.id);
    expect(u3.body.user.phoneE164).toBe(phone);
    expect(u3.body.user.phoneVerified).toBe(false);

    const dupPhone = await request(app)
      .post('/api/auth/register')
      .send({
        email: `withphone2-${Date.now()}@fortix.test`,
        password: 'StrongPassword!123',
        phone,
      });
    expect(dupPhone.status).toBe(409);
  });

  it('001B: enforces atomic single-use consumeAuthActionToken under 10 concurrent calls (zero TOCTOU double-spend)', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: `toctou-${Date.now()}@fortix.test`, password: 'StrongPassword!123' });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id as string;
    createdUserIds.push(userId);

    const issued = await issueAuthActionToken(
      userId,
      reg.body.user.email,
      'RESET_AUTHORIZATION',
      60_000,
      { skipDelivery: true }
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeAuthActionToken(issued.rawToken, 'RESET_AUTHORIZATION')
      )
    );

    const validCount = results.filter((r) => r.valid === true).length;
    const failedCount = results.filter((r) => r.valid === false).length;
    expect(validCount).toBe(1);
    expect(failedCount).toBe(9);
  });

  it('001C: enforces concurrent OTP verification atomicity — 10 parallel verify requests yield exactly 1 resetAuthorization', async () => {
    const email = `otp-race-${Date.now()}@fortix.test`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'InitialPassword!123' });
    expect(reg.status).toBe(201);
    createdUserIds.push(reg.body.user.id);

    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: email });
    expect(forgotRes.status).toBe(200);
    const { challengeId, devOtpCode } = forgotRes.body;
    expect(devOtpCode).toMatch(/^\d{6}$/);

    // Verify raw OTP is NEVER stored in database (only keyed HMAC-SHA256)
    const [storedChallenge] = await db
      .select()
      .from(recoveryChallenges)
      .where(eq(recoveryChallenges.id, challengeId));
    expect(storedChallenge.otpHmac).not.toBe(devOtpCode);
    expect(storedChallenge.otpHmac).toBe(
      computeOtpHmac(challengeId, 'PASSWORD_RESET', devOtpCode)
    );

    // Fire 10 simultaneous OTP verification requests
    const parallelResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/verify-reset-otp')
          .send({ challengeId, otp: devOtpCode })
      )
    );

    const successes = parallelResponses.filter((r) => r.status === 200);
    const rejections = parallelResponses.filter((r) => r.status !== 200);
    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(9);
    expect(successes[0].body.resetAuthorization).toMatch(/^[a-f0-9]{64}$/);
  });

  it('001C: enforces 60s resend cooldown, 5-attempt lockout, OTP expiry, confirmPassword match, single-use resetAuthorization, and session revocation', async () => {
    const email = `otp-lifecycle-${Date.now()}@fortix.test`;
    const initialPassword = 'OldStrongPassword!123';
    const nextPassword = 'NewRotatedPassword!999';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: initialPassword });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id as string;
    createdUserIds.push(userId);

    // Establish an active login session BEFORE password reset to prove reset revokes it
    const activeAgent = request.agent(app);
    const preResetLogin = await activeAgent
      .post('/api/auth/login')
      .send({ identifier: email, password: initialPassword, rememberMe: true });
    expect(preResetLogin.status).toBe(200);
    const preResetJwt = preResetLogin.body.token as string;
    const preResetCsrf = preResetLogin.body.csrfToken as string;

    // 1. Request OTP & verify immediate resend hits 60-second cooldown
    const forgot1 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: email });
    expect(forgot1.status).toBe(200);
    const challenge1 = forgot1.body.challengeId as string;

    const immediateResend = await request(app)
      .post('/api/auth/resend-reset-otp')
      .send({ challengeId: challenge1 });
    expect(immediateResend.status).toBe(429);
    expect(immediateResend.body.code).toBe('OTP_RESEND_COOLDOWN');

    // 2. Exhaust 5 wrong OTP attempts -> challenge locks out even if correct code is later sent
    const wrongOtp = forgot1.body.devOtpCode === '123456' ? '654321' : '123456';
    for (let i = 1; i <= 5; i++) {
      const attemptRes = await request(app)
        .post('/api/auth/verify-reset-otp')
        .send({ challengeId: challenge1, otp: wrongOtp });
      expect(attemptRes.status).toBe(400);
      if (i === 5) {
        expect(attemptRes.body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
      }
    }

    const postLockoutValidAttempt = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({ challengeId: challenge1, otp: forgot1.body.devOtpCode });
    expect(postLockoutValidAttempt.status).toBe(400);
    expect(postLockoutValidAttempt.body.code).toBe('OTP_ATTEMPTS_EXCEEDED');

    // 3. Expired OTP challenge is rejected
    const forgotExpired = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: email });
    const expiredChallengeId = forgotExpired.body.challengeId as string;
    await db
      .update(recoveryChallenges)
      .set({ expiresAt: new Date(Date.now() - 5000) })
      .where(eq(recoveryChallenges.id, expiredChallengeId));

    const expiredVerify = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({ challengeId: expiredChallengeId, otp: forgotExpired.body.devOtpCode });
    expect(expiredVerify.status).toBe(400);
    expect(expiredVerify.body.code).toBe('OTP_EXPIRED');

    // 4. Fresh OTP -> valid verify -> confirmPassword mismatch rejected -> valid reset succeeds & revokes sessions
    const forgotValid = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: email });
    const verifyOk = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({
        challengeId: forgotValid.body.challengeId,
        otp: forgotValid.body.devOtpCode,
      });
    expect(verifyOk.status).toBe(200);
    const resetAuth = verifyOk.body.resetAuthorization as string;

    // Missing or mismatched confirmPassword must NOT consume resetAuthorization
    const mismatchRes = await request(app)
      .post('/api/auth/reset-password')
      .send({
        resetAuthorization: resetAuth,
        newPassword: nextPassword,
        confirmPassword: 'DifferentPassword!000',
      });
    expect(mismatchRes.status).toBe(400);
    expect(mismatchRes.body.code).toBe('PASSWORD_MISMATCH');

    // Matching confirmPassword succeeds
    const resetSuccess = await request(app)
      .post('/api/auth/reset-password')
      .send({
        resetAuthorization: resetAuth,
        newPassword: nextPassword,
        confirmPassword: nextPassword,
      });
    expect(resetSuccess.status).toBe(200);

    // Replay of single-use resetAuthorization fails
    const replayReset = await request(app)
      .post('/api/auth/reset-password')
      .send({
        resetAuthorization: resetAuth,
        newPassword: 'AnotherPassword!111',
        confirmPassword: 'AnotherPassword!111',
      });
    expect(replayReset.status).toBe(400);

    // Pre-reset JWT AND pre-reset Remember-Me refresh cookie are both invalidated
    const staleJwtCheck = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${preResetJwt}`);
    expect(staleJwtCheck.status).toBe(401);

    const staleRefreshCheck = await activeAgent
      .post('/api/auth/refresh')
      .set('X-CSRF-Token', preResetCsrf);
    expect(staleRefreshCheck.status).toBe(401);

    // Old password fails, new password succeeds
    expect(
      (await request(app).post('/api/auth/login').send({ identifier: email, password: initialPassword })).status
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/login').send({ identifier: email, password: nextPassword })).status
    ).toBe(200);
  });

  it('001C: gates SMS OTP strictly on verified phone ownership (zero enumeration, zero SMS to unverified phones) and enables phone login + SMS reset once verified', async () => {
    const dispatchedSms: SmsMessagePayload[] = [];
    setAuthDeliveryProviderOverridesForTests({
      sms: {
        async send(msg) {
          dispatchedSms.push(msg);
          return { delivered: true, channel: 'SMS', provider: 'dev-sandbox-outbox' };
        },
      },
    });

    const uniqueDigits = String(Date.now() + 7).slice(-9);
    const phone = `+918${uniqueDigits}`;
    const email = `sms-gate-${Date.now()}@fortix.test`;
    const initialPass = 'PhoneGatePass!123';
    const resetViaSmsPass = 'SmsResetSuccess!456';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: initialPass, phone });
    expect(reg.status).toBe(201);
    createdUserIds.push(reg.body.user.id);

    // 1. Login via unverified phone MUST fail
    const unverifiedPhoneLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: phone, password: initialPass });
    expect(unverifiedPhoneLogin.status).toBe(401);

    // 2. Forgot-password with unverified phone returns identical generic 200 message and sends ZERO SMS
    const unverifiedForgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: phone });
    const unknownEmailForgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: `nobody-${Date.now()}@fortix.test` });

    expect(unverifiedForgot.status).toBe(200);
    expect(unverifiedForgot.body.message).toBe(unknownEmailForgot.body.message);
    expect(dispatchedSms.length).toBe(0);

    // 3. Authenticate with email, enroll & verify phone via SMS OTP
    const emailLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: initialPass });
    const jwtToken = emailLogin.body.token as string;

    const reqVerify = await request(app)
      .post('/api/auth/phone/request-verify')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ phone });
    expect(reqVerify.status).toBe(200);
    expect(dispatchedSms.length).toBe(1);
    const enrollmentOtp = dispatchedSms[0].otpCode;

    const confirmVerify = await request(app)
      .post('/api/auth/phone/confirm-verify')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ challengeId: reqVerify.body.challengeId, otp: enrollmentOtp });
    expect(confirmVerify.status).toBe(200);
    expect(confirmVerify.body.phoneVerified).toBe(true);

    // 4. Verified phone can now log in directly AND receive SMS password recovery OTP
    const verifiedPhoneLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: phone, password: initialPass });
    expect(verifiedPhoneLogin.status).toBe(200);

    const smsForgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ identifier: phone });
    expect(smsForgot.status).toBe(200);
    expect(dispatchedSms.length).toBe(2);
    const recoverySmsOtp = dispatchedSms[1].otpCode;

    const verifySmsReset = await request(app)
      .post('/api/auth/verify-reset-otp')
      .send({ challengeId: smsForgot.body.challengeId, otp: recoverySmsOtp });
    expect(verifySmsReset.status).toBe(200);

    const completeSmsReset = await request(app)
      .post('/api/auth/reset-password')
      .send({
        resetAuthorization: verifySmsReset.body.resetAuthorization,
        newPassword: resetViaSmsPass,
        confirmPassword: resetViaSmsPass,
      });
    expect(completeSmsReset.status).toBe(200);

    const postSmsResetLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: phone, password: resetViaSmsPass });
    expect(postSmsResetLogin.status).toBe(200);
  });

  it('001B: checks webhook HTTP 2xx status and invalidates challenge/token when notification provider returns HTTP 500', async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;

    try {
      const failingMailProvider = new WebhookEmailDeliveryProvider('https://mail-gateway.example.org/send');
      setAuthDeliveryProviderOverridesForTests({ email: failingMailProvider });

      const email = `webhook-500-${Date.now()}@fortix.test`;
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ email, password: 'WebhookPassword!123' });
      expect(reg.status).toBe(201);
      const userId = reg.body.user.id as string;
      createdUserIds.push(userId);

      // Email verification token generated during registration should be invalidated on HTTP 500
      const actionRows = await db
        .select()
        .from(authActionTokens)
        .where(eq(authActionTokens.userId, userId));
      expect(actionRows.length).toBe(1);
      expect(actionRows[0].usedAt).not.toBeNull();

      // Forgot-password challenge must also be invalidated on HTTP 500 without leaking delivery failure to unauthenticated probe
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: email });
      expect(forgotRes.status).toBe(200);
      expect(forgotRes.body.devOtpCode).toBeUndefined();

      const [challengeRow] = await db
        .select()
        .from(recoveryChallenges)
        .where(eq(recoveryChallenges.id, forgotRes.body.challengeId));
      expect(challengeRow.invalidatedAt).not.toBeNull();
      expect(challengeRow.invalidationReason).toBe('WEBHOOK_HTTP_500');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('001D: differentiates Remember Me vs short session cookies, rotates refresh tokens, revokes entire family on token reuse, and supports session revocation & HTTPS proxy cookies', async () => {
    const email = `remember-me-${Date.now()}@fortix.test`;
    const password = 'SessionPassword!123';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password });
    expect(reg.status).toBe(201);
    createdUserIds.push(reg.body.user.id);

    // 1. Short session (`rememberMe: false`) omits persistent Max-Age AND Reverse-Proxy HTTPS sets Secure; SameSite=None; Partitioned
    const shortLogin = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://ais-dev-example.run.app')
      .set('X-Forwarded-Host', 'ais-dev-example.run.app')
      .send({ identifier: email, password, rememberMe: false });
    expect(shortLogin.status).toBe(200);
    const shortCookies = shortLogin.headers['set-cookie'] as unknown as string[];
    const shortRefreshCookie = shortCookies.find((c) => c.startsWith('fortix_refresh='))!;
    expect(shortRefreshCookie).toBeDefined();
    expect(shortRefreshCookie).not.toMatch(/Max-Age=/i);
    expect(shortRefreshCookie).toMatch(/HttpOnly/i);
    expect(shortRefreshCookie).toMatch(/Secure/i);
    expect(shortRefreshCookie).toMatch(/SameSite=None/i);
    expect(shortRefreshCookie).toMatch(/Partitioned/i);

    // 2. Remember Me (`rememberMe: true`) sets persistent Max-Age (~30 days) and rotates on /api/auth/refresh
    const rememberLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password, rememberMe: true });
    expect(rememberLogin.status).toBe(200);
    const remCookies1 = rememberLogin.headers['set-cookie'] as unknown as string[];
    const remRefreshHeader1 = remCookies1.find((c) => c.startsWith('fortix_refresh='))!;
    const remCsrfHeader1 = remCookies1.find((c) => c.startsWith('fortix_csrf='))!;
    expect(remRefreshHeader1).toMatch(/Max-Age=/i);

    const refreshCookiePair1 = remRefreshHeader1.split(';')[0];
    const csrfCookiePair1 = remCsrfHeader1.split(';')[0];
    const csrfToken1 = rememberLogin.body.csrfToken as string;

    // Rotate refresh token once -> succeeds and issues new refresh cookie
    const rotate1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${refreshCookiePair1}; ${csrfCookiePair1}`)
      .set('X-CSRF-Token', csrfToken1);
    expect(rotate1.status).toBe(200);
    expect(rotate1.body.refreshed).toBe(true);

    const remCookies2 = rotate1.headers['set-cookie'] as unknown as string[];
    const refreshCookiePair2 = remCookies2.find((c) => c.startsWith('fortix_refresh='))!.split(';')[0];
    const csrfCookiePair2 = remCookies2.find((c) => c.startsWith('fortix_csrf='))!.split(';')[0];
    const csrfToken2 = rotate1.body.csrfToken as string;
    const rotatedAccessJwt = rotate1.body.token as string;
    expect(refreshCookiePair2).not.toBe(refreshCookiePair1);

    // 3. REPLAY DETECTION: Replaying already-rotated `refreshCookiePair1` triggers REFRESH_TOKEN_REUSED and revokes the ENTIRE family!
    const replayAttempt = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${refreshCookiePair1}; ${csrfCookiePair1}`)
      .set('X-CSRF-Token', csrfToken1);
    expect(replayAttempt.status).toBe(401);
    expect(replayAttempt.body.code).toBe('REFRESH_TOKEN_REUSED');

    // Legitimate descendant token `refreshCookiePair2` AND access JWT in that compromised family are now ALSO revoked!
    const descendantAfterReuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${refreshCookiePair2}; ${csrfCookiePair2}`)
      .set('X-CSRF-Token', csrfToken2);
    expect(descendantAfterReuse.status).toBe(401);

    const accessJwtAfterReuse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessJwt}`);
    expect(accessJwtAfterReuse.status).toBe(401);

    // 4. Active session listing & explicit session family revocation (`GET /api/auth/sessions` & `DELETE /api/auth/sessions/:familyId`)
    const listCheck = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${shortLogin.body.token}`);
    expect(listCheck.status).toBe(200);
    expect(listCheck.body.sessions.length).toBe(1);
    const activeFamilyId = listCheck.body.sessions[0].familyId as string;

    const revokeRes = await request(app)
      .delete(`/api/auth/sessions/${activeFamilyId}`)
      .set('Authorization', `Bearer ${shortLogin.body.token}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.revoked).toBe(true);

    const afterRevokeMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${shortLogin.body.token}`);
    expect(afterRevokeMe.status).toBe(401);
  });
});
