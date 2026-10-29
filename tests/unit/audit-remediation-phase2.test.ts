import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eq, inArray } from 'drizzle-orm';

import { setupApiRoutes } from '../../src/api/index.js';
import { apiGlobalErrorHandler, getTrackedErrors } from '../../src/lib/error-tracker.js';
import { evaluateReadinessContract } from '../../src/lib/readiness.js';
import { getSystemTestStatus } from '../../src/api/system.js';
import { resetAnalyticsForTests } from '../../src/lib/analytics.js';
import { withTenantContext } from '../../src/db/rls.js';
import {
  exportWorkspaceBackup,
  verifyWorkspaceBackupIntegrity,
  restoreWorkspaceBackup,
} from '../../src/db/backup.js';
import { DEMO_WORKSPACE_NAME } from '../../src/api/demo-workspace.js';
import { db } from '../../src/db/index.js';
import {
  users,
  organizations,
  projects,
  apiRoutes,
  apiKeys,
  securityPolicies,
  experiments,
  verifications,
  webhooks,
} from '../../src/db/schema.js';

describe('Phase 2 Audit Remediation Regressions (FX-REL-013 through FX-UX-019)', () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  // Intentional crash endpoint mounted BEFORE apiGlobalErrorHandler to verify FX-OBS-016 scrubbing
  app.post('/api/test-unhandled-crash', (_req, _res, next) => {
    const dbLeakError = new Error(
      'FATAL SQL: password=SuperSecretDbPass! connection postgres://admin:dbpass123@db.internal:5432/fortix for operator@fortix.io'
    );
    next(dbLeakError);
  });

  setupApiRoutes(app);
  app.use('/api', apiGlobalErrorHandler);

  const plainPassword = 'AuditPhase2Strong!99';
  const adminUser = {
    id: uuidv4(),
    email: `audit2-admin-${Date.now()}@fortix.test`,
    orgId: uuidv4(),
    projectId: uuidv4(),
    routeId: uuidv4(),
    token: '',
    cookieHeader: [] as string[],
    csrfToken: '',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    await db.insert(users).values({
      id: adminUser.id,
      email: adminUser.email,
      passwordHash,
      role: 'ADMIN',
      emailVerified: true,
    });

    await db.insert(organizations).values({
      id: adminUser.orgId,
      name: 'Phase 2 Audit Org',
      ownerId: adminUser.id,
    });

    await db.insert(projects).values({
      id: adminUser.projectId,
      orgId: adminUser.orgId,
      name: 'Critical Production API',
      environment: 'production',
    });

    await db.insert(apiRoutes).values({
      id: adminUser.routeId,
      projectId: adminUser.projectId,
      pathPattern: '/v2/payments',
      targetUrl: 'http://fortix-demo-api:3001/api/payment',
    });

    await db.insert(securityPolicies).values({
      id: uuidv4(),
      routeId: adminUser.routeId,
      rateLimitRpm: 90,
      enableWaf: true,
      enableSsrf: true,
    });

    const expId = uuidv4();
    await db.insert(experiments).values({
      id: expId,
      routeId: adminUser.routeId,
      type: 'latency',
      status: 'COMPLETED',
      config: { latencyMs: 250, durationMs: 5000 },
    });

    await db.insert(verifications).values({
      id: uuidv4(),
      experimentId: expId,
      expected: { maxLatencyP95: 500 },
      observed: { latencyP95: 290 },
      verdict: 'PASSED',
    });

    await db.insert(apiKeys).values({
      id: uuidv4(),
      name: 'Audit2 Gateway Key',
      projectId: adminUser.projectId,
      keyPrefix: 'fx_live_audit2',
      secretHash: '$2b$10$dontleakthissecrethashvalue000000000000000000000000',
    });

    await db.insert(webhooks).values({
      id: uuidv4(),
      name: 'Audit2 Security Alert Hook',
      projectId: adminUser.projectId,
      url: 'https://hooks.example.com/fortix',
      secret: 'whsec_raw_signing_secret_do_not_export',
      events: ['SECURITY_ALERT'],
      isActive: true,
    });
  });

  it('FX-REL-013: evaluateReadinessContract distinguishes ephemeral sandbox from persistent mode and fails closed on strict/remote configs', async () => {
    const ephemeralHealth = {
      status: 'healthy',
      postgres: { status: 'healthy', storageMode: 'in-memory' as const, migrationStatus: 'verified' as const },
      redis: { status: 'healthy', storageMode: 'in-memory' as const },
    };

    // 1. Zero-config sandbox: honest ephemeral_ready, persistenceVerified === false
    const sandboxEval = evaluateReadinessContract(ephemeralHealth, {
      TEST_READINESS_CONTRACT: 'true',
    } as any);
    expect(sandboxEval.httpStatus).toBe(200);
    expect(sandboxEval.status).toBe('ephemeral_ready');
    expect(sandboxEval.deploymentMode).toBe('ephemeral-sandbox');
    expect(sandboxEval.persistenceVerified).toBe(false);
    expect(sandboxEval.warnings.length).toBeGreaterThanOrEqual(2);

    // 2. STRICT_PERSISTENT_DB=true with in-memory Postgres -> 503 unhealthy
    const strictDbEval = evaluateReadinessContract(ephemeralHealth, {
      TEST_READINESS_CONTRACT: 'true',
      STRICT_PERSISTENT_DB: 'true',
    } as any);
    expect(strictDbEval.httpStatus).toBe(503);
    expect(strictDbEval.isReady).toBe(false);
    expect(strictDbEval.status).toBe('unhealthy');

    // 3. STRICT_REDIS_READINESS=true with in-memory Redis -> 503 unhealthy
    const strictRedisEval = evaluateReadinessContract(ephemeralHealth, {
      TEST_READINESS_CONTRACT: 'true',
      STRICT_REDIS_READINESS: 'true',
    } as any);
    expect(strictRedisEval.httpStatus).toBe(503);
    expect(strictRedisEval.isReady).toBe(false);
    expect(strictRedisEval.redisReady).toBe(false);

    // 4. Explicit remote DATABASE_URL configured while running in-memory -> 503 unhealthy
    const remoteDbFallbackEval = evaluateReadinessContract(ephemeralHealth, {
      TEST_READINESS_CONTRACT: 'true',
      DATABASE_URL: 'postgresql://app:secret@ep-cloud.us-east-2.aws.neon.tech/fortix?sslmode=require',
    } as any);
    expect(remoteDbFallbackEval.httpStatus).toBe(503);
    expect(remoteDbFallbackEval.postgresReady).toBe(false);

    // 5. Explicit remote REDIS_URL configured while running in-memory -> 503 unhealthy
    const remoteRedisFallbackEval = evaluateReadinessContract(ephemeralHealth, {
      TEST_READINESS_CONTRACT: 'true',
      REDIS_URL: 'rediss://default:secret@global-redis.upstash.io:6379',
    } as any);
    expect(remoteRedisFallbackEval.httpStatus).toBe(503);
    expect(remoteRedisFallbackEval.redisReady).toBe(false);

    // 6. Failed migrations -> 503 unhealthy even on persistent Postgres
    const failedMigrationEval = evaluateReadinessContract(
      {
        status: 'healthy',
        postgres: { status: 'healthy', storageMode: 'persistent', migrationStatus: 'failed', migrationError: 'syntax error' },
        redis: { status: 'healthy', storageMode: 'persistent' },
      },
      { TEST_READINESS_CONTRACT: 'true' } as any
    );
    expect(failedMigrationEval.httpStatus).toBe(503);
    expect(failedMigrationEval.isReady).toBe(false);

    // 7. Verified persistent Postgres + persistent Redis -> 200 ok & persistenceVerified === true
    const persistentEval = evaluateReadinessContract(
      {
        status: 'healthy',
        postgres: { status: 'healthy', storageMode: 'persistent', migrationStatus: 'verified' },
        redis: { status: 'healthy', storageMode: 'persistent' },
      },
      {
        TEST_READINESS_CONTRACT: 'true',
        STRICT_PERSISTENT_DB: 'true',
        STRICT_REDIS_READINESS: 'true',
      } as any
    );
    expect(persistentEval.httpStatus).toBe(200);
    expect(persistentEval.status).toBe('ok');
    expect(persistentEval.deploymentMode).toBe('persistent');
    expect(persistentEval.persistenceVerified).toBe(true);
    expect(persistentEval.warnings).toEqual([]);

    // 8. Live endpoint check in sandbox test runtime
    const liveRes = await request(app).get('/api/health/ready');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.persistenceVerified).toBe(false);
    expect(liveRes.body.postgresStorageMode).toBe('in-memory');
    expect(liveRes.body.redisStorageMode).toBe('in-memory');
  });

  it('FX-SEC-014: browser login issues HttpOnly session cookie without exposing bearer JWT in JSON body', async () => {
    const browserLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Fortix-Client', 'browser')
      .send({ email: adminUser.email, password: plainPassword });

    expect(browserLogin.status).toBe(200);
    expect(browserLogin.body.token).toBeUndefined();
    expect(browserLogin.body.sessionMode).toBe('httpOnly-cookie');
    expect(browserLogin.body.csrfToken).toBeTruthy();

    const setCookies = browserLogin.headers['set-cookie'] as unknown as string[];
    expect(Array.isArray(setCookies)).toBe(true);
    expect(setCookies.some((c) => c.startsWith('fortix_session=') && c.includes('HttpOnly'))).toBe(true);

    adminUser.cookieHeader = setCookies.map((c) => c.split(';')[0]);
    adminUser.csrfToken = browserLogin.body.csrfToken;

    // Cookie-only session authenticates cleanly
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', adminUser.cookieHeader.join('; '));
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(adminUser.email);

    // Non-browser SDK/CLI login still receives token for programmatic automation
    const cliLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: adminUser.email, password: plainPassword });
    expect(cliLogin.status).toBe(200);
    expect(typeof cliLogin.body.token).toBe('string');
    adminUser.token = cliLogin.body.token;
  });

  it('FX-INT-015: getSystemTestStatus never fabricates hardcoded test counts when artifact is absent', () => {
    const summaryPath = path.join(process.cwd(), 'test-results', 'vitest-summary.json');
    const existed = fs.existsSync(summaryPath);
    const backupContent = existed ? fs.readFileSync(summaryPath, 'utf8') : null;

    try {
      if (existed) fs.unlinkSync(summaryPath);
      const unverified = getSystemTestStatus();
      expect(unverified.verifiedFromArtifact).toBe(false);
      expect(unverified.status).toBe('UNVERIFIED_AT_RUNTIME');
      expect(unverified.totalTests).toBe(0);
      expect(unverified.passed).toBe(0);

      fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          numTotalTests: 92,
          numPassedTests: 92,
          numFailedTests: 0,
          numTotalTestSuites: 24,
          numPassedTestSuites: 24,
          success: true,
          startTime: Date.now(),
        })
      );

      const verified = getSystemTestStatus();
      expect(verified.verifiedFromArtifact).toBe(true);
      expect(verified.status).toBe('PASSED');
      expect(verified.totalTests).toBe(92);
      expect(verified.passed).toBe(92);
    } finally {
      if (backupContent !== null) {
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        fs.writeFileSync(summaryPath, backupContent);
      } else if (fs.existsSync(summaryPath)) {
        fs.unlinkSync(summaryPath);
      }
    }
  });

  it('FX-OBS-016: unhandled API error returns safe contract and scrubs secrets, tokens, cookies, URIs, and PII from telemetry', async () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart12345';
    const fakePat = 'ghp_1234567890abcdefghijklmnopqrstuvwx';
    const fakeFxKey = 'fx_live_99887766554433221100aabbccddeeff';

    const crashRes = await request(app)
      .post('/api/test-unhandled-crash?token=QuerySecretToken999')
      .set('Authorization', `Bearer ${fakeJwt}`)
      .set('X-API-Key', fakeFxKey)
      .set('Cookie', 'fortix_session=RawSessionCookieSecret888')
      .send({
        password: 'MyPlaintextPassword!123',
        note: `Using PAT ${fakePat} against postgres://admin:dbpass123@db.internal:5432/fortix`,
      });

    expect(crashRes.status).toBe(500);
    expect(crashRes.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(typeof crashRes.body.error).toBe('string');
    expect(typeof crashRes.body.recoveryHint).toBe('string');
    expect(crashRes.body.stack).toBeUndefined();

    // Response body must never leak raw SQL credentials or stack trace
    const serializedResponse = JSON.stringify(crashRes.body);
    expect(serializedResponse).not.toContain('SuperSecretDbPass!');
    expect(serializedResponse).not.toContain('dbpass123');

    // Stored error telemetry must scrub all sensitive inputs
    const allTracked = JSON.stringify(getTrackedErrors(20));
    expect(allTracked).not.toContain('SuperSecretDbPass!');
    expect(allTracked).not.toContain('dbpass123');
    expect(allTracked).not.toContain('QuerySecretToken999');
    expect(allTracked).not.toContain('RawSessionCookieSecret888');
    expect(allTracked).not.toContain('MyPlaintextPassword!123');
    expect(allTracked).not.toContain(fakeJwt);
    expect(allTracked).not.toContain(fakePat);
    expect(allTracked).not.toContain(fakeFxKey);
    expect(allTracked).not.toContain('operator@fortix.io');
    expect(allTracked).toContain('[REDACTED');
  });

  it('FX-OBS-017: first-party analytics enforces strict zero-PII event allowlist and honors opt-out', async () => {
    resetAnalyticsForTests();

    // Allowed event increments counter
    const okRes = await request(app)
      .post('/api/control/system/analytics/event')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({ event: 'route_registered', workspaceMode: 'standard' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.recorded).toBe(true);

    // Arbitrary / PII-bearing event name is rejected by allowlist
    const piiRes = await request(app)
      .post('/api/control/system/analytics/event')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({ event: 'user_alice@example.com_login', workspaceMode: 'standard' });
    expect(piiRes.status).toBe(200);
    expect(piiRes.body.recorded).toBe(false);
    expect(piiRes.body.reason).toBe('disallowed_event_name');

    // Opt-out header suppresses recording
    const optOutRes = await request(app)
      .post('/api/control/system/analytics/event')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .set('X-Fortix-Analytics-Opt-Out', 'true')
      .send({ event: 'experiment_triggered', workspaceMode: 'demo' });
    expect(optOutRes.status).toBe(200);
    expect(optOutRes.body.recorded).toBe(false);
    expect(optOutRes.body.reason).toBe('opt_out');

    const summaryRes = await request(app)
      .get('/api/control/system/analytics/summary')
      .set('Authorization', `Bearer ${adminUser.token}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.totalEvents).toBe(1);
    expect(summaryRes.body.counts.route_registered).toBe(1);
    expect(summaryRes.body.counts.experiment_triggered).toBe(0);
  });

  it('FX-DB-018: RLS SQL covers all tenant tables with WITH CHECK, withTenantContext runs cleanly, and signed backup/restore drill succeeds', async () => {
    const rlsSql = fs.readFileSync(
      path.join(process.cwd(), 'drizzle', 'postgres_rls_policies.sql'),
      'utf8'
    );
    expect(rlsSql).toContain('NOBYPASSRLS');
    for (const table of [
      'organizations',
      'projects',
      'project_settings',
      'api_routes',
      'api_keys',
      'security_policies',
      'experiments',
      'verifications',
      'webhooks',
      'workflow_runs',
    ]) {
      expect(rlsSql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(rlsSql).toContain('WITH CHECK');

    // Execute transaction-scoped tenant context helper
    const rlsProjects = await withTenantContext(adminUser.id, async (tx) => {
      return tx.select().from(projects).where(eq(projects.orgId, adminUser.orgId));
    });
    expect(rlsProjects.some((p) => p.id === adminUser.projectId)).toBe(true);

    // Export signed backup via Admin endpoint
    const exportRes = await request(app)
      .get(`/api/control/admin/backups/export?projectId=${adminUser.projectId}`)
      .set('Authorization', `Bearer ${adminUser.token}`);
    expect(exportRes.status).toBe(200);
    const snapshot = exportRes.body;
    expect(snapshot.format).toBe('fortix-workspace-backup-v1');

    // Secret hashes and webhook signing secrets must be stripped
    const rawSnapshotJson = JSON.stringify(snapshot);
    expect(rawSnapshotJson).not.toContain('dontleakthissecrethashvalue');
    expect(rawSnapshotJson).not.toContain('whsec_raw_signing_secret_do_not_export');

    // Verify integrity via Admin endpoint
    const verifyOk = await request(app)
      .post('/api/control/admin/backups/verify')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send(snapshot);
    expect(verifyOk.status).toBe(200);
    expect(verifyOk.body.valid).toBe(true);

    // Tampered payload must fail SHA-256 verification
    const tampered = JSON.parse(rawSnapshotJson);
    tampered.payload.project.name = 'Tampered Name';
    expect(verifyWorkspaceBackupIntegrity(tampered).valid).toBe(false);

    // Full backup -> wipe -> restore verification drill into a fresh project ID
    const restoredProjectId = uuidv4();
    const restoreSummary = await restoreWorkspaceBackup(snapshot, adminUser.orgId, restoredProjectId);
    expect(restoreSummary.restoredProjectId).toBe(restoredProjectId);
    expect(restoreSummary.routesRestored).toBe(1);
    expect(restoreSummary.policiesRestored).toBe(1);
    expect(restoreSummary.experimentsRestored).toBe(1);

    const restoredRoutes = await db
      .select()
      .from(apiRoutes)
      .where(eq(apiRoutes.projectId, restoredProjectId));
    expect(restoredRoutes).toHaveLength(1);
    expect(restoredRoutes[0].pathPattern).toBe('/v2/payments');

    const restoredExps = await db
      .select()
      .from(experiments)
      .where(inArray(experiments.routeId, restoredRoutes.map((r) => r.id)));
    expect(restoredExps).toHaveLength(1);
  });

  it('FX-UX-019: demo workspace provisioner creates isolated [DEMO] workspace with DEMO_SEED provenance and resets idempotently', async () => {
    const firstReset = await request(app)
      .post('/api/control/projects/demo-workspace/reset')
      .set('Cookie', adminUser.cookieHeader.join('; '))
      .set('X-CSRF-Token', adminUser.csrfToken);

    expect(firstReset.status).toBe(200);
    expect(firstReset.body.project.name).toBe(DEMO_WORKSPACE_NAME);
    expect(firstReset.body.routesCreated).toBe(4);
    expect(firstReset.body.provenance).toBe('DEMO_SEED');

    const demoProjectId = firstReset.body.project.id;
    expect(demoProjectId).not.toBe(adminUser.projectId);

    // Second reset is idempotent and preserves non-demo projects
    const secondReset = await request(app)
      .post('/api/control/projects/demo-workspace/reset')
      .set('Cookie', adminUser.cookieHeader.join('; '))
      .set('X-CSRF-Token', adminUser.csrfToken);

    expect(secondReset.status).toBe(200);
    expect(secondReset.body.project.id).toBe(demoProjectId);

    const demoRoutes = await db
      .select()
      .from(apiRoutes)
      .where(eq(apiRoutes.projectId, demoProjectId));
    expect(demoRoutes).toHaveLength(4);

    // Production project remains completely untouched
    const [prodProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, adminUser.projectId));
    expect(prodProject?.name).toBe('Critical Production API');
  });
});
