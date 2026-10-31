import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

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
  metricLogs,
  workflowRuns,
} from '../../src/db/schema.js';
import { setupGateway, invalidateExpCache } from '../../src/gateway/index.js';
import { setupApiRoutes } from '../../src/api/index.js';
import { verifyPolicy } from '../../src/verification/engine.js';
import { computePhaseMetrics, deduplicateMetrics } from '../../src/verification/domain.js';
import { runExperimentLogic } from '../../src/experiments/worker.js';
import { executeAutonomousRun } from '../../src/autonomous/engine.js';
import { calculateScores } from '../../src/scoring/index.js';
import { redisConnection } from '../../src/redis.js';
import {
  METRICS_STREAM_KEY,
  enqueueMetric,
  flushTelemetryBarrier,
  __trackInFlightTelemetryOpForTests,
  __clearTelemetryStateForTests,
} from '../../src/lib/telemetry.js';

describe('FTX-CORE-VERIFY-001 — Verification Engine Correctness & Evidence Integrity', () => {
  const jwtSecret = process.env.JWT_SECRET || 'secret';
  const originalPort = process.env.PORT;
  const originalRedisFailure = process.env.REDIS_FAILURE_BEHAVIOR;

  let gatewayApp: express.Express;
  let gatewayServer: http.Server;
  let gatewayPort: number;

  let upstreamServer: http.Server;
  let upstreamPort: number;
  let upstreamMode: 'healthy' | 'error_503' = 'healthy';

  const tenantA = {
    userId: uuidv4(),
    email: `verify-rigor-a-${Date.now()}@fortix.test`,
    orgId: uuidv4(),
    projectId: uuidv4(),
    token: '',
    rawApiKey: '',
    apiKeyId: '',
  };

  const tenantB = {
    userId: uuidv4(),
    email: `verify-rigor-b-${Date.now()}@fortix.test`,
    orgId: uuidv4(),
    projectId: uuidv4(),
    token: '',
  };

  async function createRouteWithPolicy(opts?: {
    projectId?: string;
    pathPattern?: string;
    targetPath?: string;
    rateLimitRpm?: number | null;
    enableWaf?: boolean;
    omitPolicy?: boolean;
  }) {
    const routeId = uuidv4();
    const projectId = opts?.projectId || tenantA.projectId;
    await db.insert(apiRoutes).values({
      id: routeId,
      projectId,
      pathPattern: opts?.pathPattern || `/v1/rigor-${routeId.slice(0, 8)}`,
      targetUrl: `http://fortix-demo-api.internal:${upstreamPort}${opts?.targetPath || '/ok'}`,
    });

    let policyId: string | null = null;
    if (!opts?.omitPolicy) {
      policyId = uuidv4();
      await db.insert(securityPolicies).values({
        id: policyId,
        routeId,
        rateLimitRpm: opts?.rateLimitRpm !== undefined ? (opts.rateLimitRpm as any) : 60,
        enableWaf: opts?.enableWaf ?? true,
        enableSsrf: true,
      });
    }

    return { routeId, policyId };
  }

  beforeAll(async () => {
    process.env.REDIS_FAILURE_BEHAVIOR = 'fail-open';

    upstreamServer = http.createServer((req, res) => {
      if (upstreamMode === 'error_503' || req.url?.startsWith('/always-503')) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', path: req.url }));
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, '127.0.0.1', () => {
        upstreamPort = (upstreamServer.address() as any).port;
        resolve();
      });
    });

    gatewayApp = express();
    gatewayApp.use(express.json());
    setupApiRoutes(gatewayApp);
    setupGateway(gatewayApp);

    gatewayServer = http.createServer(gatewayApp);
    await new Promise<void>((resolve) => {
      gatewayServer.listen(0, '127.0.0.1', () => {
        gatewayPort = (gatewayServer.address() as any).port;
        process.env.PORT = String(gatewayPort);
        resolve();
      });
    });

    tenantA.token = jwt.sign({ id: tenantA.userId, email: tenantA.email, role: 'ADMIN' }, jwtSecret);
    tenantB.token = jwt.sign({ id: tenantB.userId, email: tenantB.email, role: 'ADMIN' }, jwtSecret);

    await db.insert(users).values([
      { id: tenantA.userId, email: tenantA.email, passwordHash: 'hash-a', role: 'ADMIN' },
      { id: tenantB.userId, email: tenantB.email, passwordHash: 'hash-b', role: 'ADMIN' },
    ]);

    await db.insert(organizations).values([
      { id: tenantA.orgId, name: 'Rigor Org A', ownerId: tenantA.userId },
      { id: tenantB.orgId, name: 'Rigor Org B', ownerId: tenantB.userId },
    ]);

    await db.insert(projects).values([
      { id: tenantA.projectId, orgId: tenantA.orgId, name: 'Rigor Project A', environment: 'production' },
      { id: tenantB.projectId, orgId: tenantB.orgId, name: 'Rigor Project B', environment: 'production' },
    ]);

    const keyId = crypto.randomBytes(8).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    tenantA.apiKeyId = keyId;
    tenantA.rawApiKey = `fx_live_${keyId}_${secret}`;

    await db.insert(apiKeys).values({
      id: keyId,
      projectId: tenantA.projectId,
      keyPrefix: `fx_live_${keyId}`,
      secretHash: await bcrypt.hash(secret, 10),
      name: 'Rigor Tenant A Key',
    });
  });

  beforeEach(async () => {
    upstreamMode = 'healthy';
    __clearTelemetryStateForTests();
    await redisConnection.del(METRICS_STREAM_KEY);
  });

  afterAll(async () => {
    __clearTelemetryStateForTests();
    if (originalPort !== undefined) process.env.PORT = originalPort;
    else delete process.env.PORT;

    if (originalRedisFailure !== undefined) process.env.REDIS_FAILURE_BEHAVIOR = originalRedisFailure;
    else delete process.env.REDIS_FAILURE_BEHAVIOR;

    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  });

  it('1. Telemetry flush ordering: awaits delayed in-flight writes and drains buffered Redis stream entries before verifyPolicy queries DB', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const t0 = new Date(Date.now() - 1000);
    const t1 = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 200, durationMs: 2000 },
      startedAt: t0,
    });

    // Seed 3 baseline and 3 recovery observations directly
    const baseStart = new Date(t0.getTime() - 600);
    const baseEnd = new Date(t0.getTime() - 100);
    const recStart = new Date(t1.getTime() + 10);
    const recEnd = new Date(t1.getTime() + 200);

    const baseIds = ['b1', 'b2', 'b3'].map((s) => `${s}_${expId.slice(0, 6)}`);
    const recIds = ['r1', 'r2', 'r3'].map((s) => `${s}_${expId.slice(0, 6)}`);

    await db.insert(metricLogs).values([
      ...baseIds.map((reqId, idx) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: reqId,
        latencyMs: 18 + idx,
        statusCode: 200,
        timestamp: new Date(baseStart.getTime() + idx * 20),
      })),
      ...recIds.map((reqId, idx) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: reqId,
        latencyMs: 20 + idx,
        statusCode: 200,
        timestamp: new Date(recStart.getTime() + idx * 20),
      })),
    ]);

    // Enqueue 4 metrics ONLY in Redis Stream (not yet in PostgreSQL metricLogs!)
    for (let i = 1; i <= 4; i++) {
      await redisConnection.xadd(
        METRICS_STREAM_KEY,
        '*',
        'data',
        JSON.stringify({
          id: uuidv4(),
          routeId,
          experimentId: expId,
          requestId: `stream_inj_${expId.slice(0, 6)}_${i}`,
          latencyMs: 215 + i,
          statusCode: 200,
          timestamp: new Date(t0.getTime() + i * 50).toISOString(),
        })
      );
    }

    // Track 2 delayed in-flight telemetry promises that resolve asynchronously without sleep in caller
    for (let j = 5; j <= 6; j++) {
      const delayedWrite = new Promise<void>((resolve) => {
        setTimeout(async () => {
          await db.insert(metricLogs).values({
            id: uuidv4(),
            routeId,
            experimentId: expId,
            requestId: `inflight_inj_${expId.slice(0, 6)}_${j}`,
            latencyMs: 225 + j,
            statusCode: 200,
            timestamp: new Date(t0.getTime() + j * 50),
          });
          resolve();
        }, 45);
      });
      __trackInFlightTelemetryOpForTests(delayedWrite);
    }

    const result = await verifyPolicy(expId, policyId, t0, t1, {
      phases: {
        baseline: { startTime: baseStart, endTime: baseEnd, requestsSent: 3, requestIds: baseIds },
        injection: { startTime: t0, endTime: t1, requestsSent: 6 },
        recovery: { startTime: recStart, endTime: recEnd, requestsSent: 3, requestIds: recIds },
      },
      recoveryDurationMs: 25,
      requireBaseline: true,
      requireRecovery: true,
    });

    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('PASS');
    const observed = result!.observed as any;
    expect(observed.telemetrySync.synchronized).toBe(true);
    expect(observed.telemetrySync.inFlightResolved).toBeGreaterThanOrEqual(2);
    expect(observed.telemetrySync.streamDrainedCount).toBeGreaterThanOrEqual(4);
    expect(observed.total).toBe(6);
    expect(observed.percentiles).not.toBeNull();
  });

  it('2. Telemetry timeout and ingestion failure: returns INCONCLUSIVE when telemetry barrier times out or persistence fails', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });

    // 2a: Stalled in-flight telemetry op exceeds syncTimeoutMs -> TELEMETRY_SYNC_TIMEOUT
    const expTimeoutId = uuidv4();
    const now = new Date();
    await db.insert(experiments).values({
      id: expTimeoutId,
      routeId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 200 },
      startedAt: now,
    });

    let releaseStalled!: () => void;
    const stalledOp = new Promise<void>((resolve) => {
      releaseStalled = resolve;
    });
    __trackInFlightTelemetryOpForTests(stalledOp);

    try {
      const timedOutVerif = await verifyPolicy(expTimeoutId, policyId, now, new Date(), {
        syncTimeoutMs: 35,
      });
      expect(timedOutVerif!.verdict).toBe('INCONCLUSIVE');
      expect((timedOutVerif!.observed as any).reasonCode).toBe('TELEMETRY_SYNC_TIMEOUT');
      expect((timedOutVerif!.observed as any).telemetrySync.timedOut).toBe(true);
      expect((timedOutVerif!.observed as any).telemetrySync.synchronized).toBe(false);
    } finally {
      releaseStalled();
      await flushTelemetryBarrier({ timeoutMs: 200 });
    }

    // 2b: Unpersisted telemetry ingestion failure (invalid FK routeId cannot persist in DB or stream drain) -> TELEMETRY_INGESTION_ERROR
    __clearTelemetryStateForTests();
    const expFailId = uuidv4();
    const failStart = new Date();
    await db.insert(experiments).values({
      id: expFailId,
      routeId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 200 },
      startedAt: failStart,
    });

    await enqueueMetric({
      id: uuidv4(),
      routeId: uuidv4(), // Non-existent route triggers FK error on both direct insert and stream drain
      experimentId: expFailId,
      latencyMs: 210,
      statusCode: 200,
    });

    const ingestionErrVerif = await verifyPolicy(expFailId, policyId, failStart, new Date());
    expect(ingestionErrVerif!.verdict).toBe('INCONCLUSIVE');
    expect((ingestionErrVerif!.observed as any).reasonCode).toBe('TELEMETRY_INGESTION_ERROR');
    expect((ingestionErrVerif!.observed as any).telemetrySync.synchronized).toBe(false);
  });

  it('3. Zero observed requests: returns INCONCLUSIVE with null metrics and never fabricates 0% error rate or PASS', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const start = new Date(Date.now() - 1000);
    const end = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'error_5xx',
      status: 'ANALYZING',
      config: { durationMs: 1000 },
      startedAt: start,
    });

    const verif = await verifyPolicy(expId, policyId, start, end);
    expect(verif!.verdict).toBe('INCONCLUSIVE');
    const obs = verif!.observed as any;
    expect(obs.reasonCode).toBe('ZERO_OBSERVED_REQUESTS');
    expect(obs.total).toBe(0);
    expect(obs.avgLatencyMs).toBeNull();
    expect(obs.errorRatePercent).toBeNull();
    expect(obs.percentiles).toBeNull();
  });

  it('4. Insufficient sample sizes: < 5 injection observations returns INCONCLUSIVE and suppresses percentile fabrication', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const start = new Date(Date.now() - 500);
    const end = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 150 },
      startedAt: start,
    });

    for (let i = 1; i <= 3; i++) {
      await db.insert(metricLogs).values({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: `small_${expId}_${i}`,
        latencyMs: 165,
        statusCode: 200,
        timestamp: new Date(start.getTime() + i * 40),
      });
    }

    const verif = await verifyPolicy(expId, policyId, start, end);
    expect(verif!.verdict).toBe('INCONCLUSIVE');
    const obs = verif!.observed as any;
    expect(obs.reasonCode).toBe('INSUFFICIENT_INJECTION_SAMPLES');
    expect(obs.percentiles).toBeNull();
  });

  it('5. Rate-limit enforcement success: burst through real gateway records 429s in metricLogs and verifies PASS', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 8 });
    const expId = uuidv4();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'traffic_burst',
      status: 'RUNNING',
      config: { durationMs: 2000 },
      startedAt: new Date(),
    });
    invalidateExpCache(routeId);

    // Baseline using dedicated key
    const baseKeyId = crypto.randomBytes(8).toString('hex');
    const baseSecret = crypto.randomBytes(32).toString('hex');
    const baseRawKey = `fx_test_${baseKeyId}_${baseSecret}`;
    await db.insert(apiKeys).values({
      id: baseKeyId,
      projectId: tenantA.projectId,
      keyPrefix: `fx_test_${baseKeyId}`,
      secretHash: await bcrypt.hash(baseSecret, 10),
      name: 'Burst Baseline Key',
    });

    const baseStart = new Date();
    const baseIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const pid = `rl_base_${expId.slice(0, 8)}_${i}`;
      baseIds.push(pid);
      const r = await request(gatewayApp)
        .get(`/proxy/${routeId}`)
        .set('X-API-Key', baseRawKey)
        .set('x-experiment-id', expId)
        .set('x-fortix-probe-id', pid);
      expect(r.status).toBe(200);
    }
    const baseEnd = new Date();

    // Injection burst of 22 requests against rateLimitRpm=8 using fresh key
    const injKeyId = crypto.randomBytes(8).toString('hex');
    const injSecret = crypto.randomBytes(32).toString('hex');
    const injRawKey = `fx_test_${injKeyId}_${injSecret}`;
    await db.insert(apiKeys).values({
      id: injKeyId,
      projectId: tenantA.projectId,
      keyPrefix: `fx_test_${injKeyId}`,
      secretHash: await bcrypt.hash(injSecret, 10),
      name: 'Burst Injection Key',
    });

    const injStart = new Date();
    const burstCount = 22;
    const responses = await Promise.all(
      Array.from({ length: burstCount }, (_, idx) =>
        request(gatewayApp)
          .get(`/proxy/${routeId}`)
          .set('X-API-Key', injRawKey)
          .set('x-experiment-id', expId)
          .set('x-fortix-probe-id', `rl_inj_${expId.slice(0, 8)}_${idx + 1}`)
      )
    );
    const injEnd = new Date();

    const http200s = responses.filter((r) => r.status === 200).length;
    const http429s = responses.filter((r) => r.status === 429).length;
    expect(http200s).toBeGreaterThan(0);
    expect(http200s).toBeLessThanOrEqual(9);
    expect(http429s).toBeGreaterThanOrEqual(12);

    // Recovery using fresh key
    await db.update(experiments).set({ status: 'OBSERVING' }).where(eq(experiments.id, expId));
    invalidateExpCache(routeId);

    const recStart = new Date();
    const recIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const pid = `rl_rec_${expId.slice(0, 8)}_${i}`;
      recIds.push(pid);
      const r = await request(gatewayApp)
        .get(`/proxy/${routeId}`)
        .set('X-API-Key', baseRawKey)
        .set('x-experiment-id', expId)
        .set('x-fortix-probe-id', pid);
      expect(r.status).toBe(200);
    }
    const recEnd = new Date();

    const verif = await verifyPolicy(expId, policyId, injStart, injEnd, {
      phases: {
        baseline: { startTime: baseStart, endTime: baseEnd, requestsSent: 3, requestIds: baseIds },
        injection: { startTime: injStart, endTime: injEnd, requestsSent: burstCount },
        recovery: { startTime: recStart, endTime: recEnd, requestsSent: 3, requestIds: recIds },
      },
      recoveryDurationMs: 12,
      requireBaseline: true,
      requireRecovery: true,
    });

    expect(verif!.verdict).toBe('PASS');
    const obs = verif!.observed as any;
    expect(obs.reasonCode).toBe('RATE_LIMIT_ENFORCEMENT_VERIFIED');
    expect(obs.rejected).toBe(http429s);
    expect(obs.accepted).toBe(http200s);
  });

  it('6. Rate-limit enforcement failure & sub-capacity burst: sub-capacity returns INCONCLUSIVE; bypassed limiter returns FAIL', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 15 });

    // 6a: Sub-capacity burst (8 requests against RPM=15 -> never exercises limiter -> INCONCLUSIVE)
    const subCapExpId = uuidv4();
    const subStart = new Date(Date.now() - 400);
    const subEnd = new Date();
    await db.insert(experiments).values({
      id: subCapExpId,
      routeId,
      type: 'traffic_burst',
      status: 'ANALYZING',
      config: {},
      startedAt: subStart,
    });

    for (let i = 1; i <= 8; i++) {
      await db.insert(metricLogs).values({
        id: uuidv4(),
        routeId,
        experimentId: subCapExpId,
        requestId: `subcap_${subCapExpId}_${i}`,
        latencyMs: 15,
        statusCode: 200,
        timestamp: new Date(subStart.getTime() + i * 20),
      });
    }

    const subVerif = await verifyPolicy(subCapExpId, policyId, subStart, subEnd);
    expect(subVerif!.verdict).toBe('INCONCLUSIVE');
    expect((subVerif!.observed as any).reasonCode).toBe('INSUFFICIENT_TRAFFIC_TO_TRIGGER_RATE_LIMIT');

    // 6b: Broken / bypassed limiter (30 accepted 200s, 0 rejected 429s in 300ms against RPM=15 -> FAIL)
    const bypassExpId = uuidv4();
    const bypStart = new Date(Date.now() - 300);
    const bypEnd = new Date();
    await db.insert(experiments).values({
      id: bypassExpId,
      routeId,
      type: 'traffic_burst',
      status: 'ANALYZING',
      config: {},
      startedAt: bypStart,
    });

    for (let i = 1; i <= 30; i++) {
      await db.insert(metricLogs).values({
        id: uuidv4(),
        routeId,
        experimentId: bypassExpId,
        requestId: `bypass_${bypassExpId}_${i}`,
        latencyMs: 12,
        statusCode: 200,
        timestamp: new Date(bypStart.getTime() + i * 5),
      });
    }

    const bypassVerif = await verifyPolicy(bypassExpId, policyId, bypStart, bypEnd);
    expect(bypassVerif!.verdict).toBe('FAIL');
    expect((bypassVerif!.observed as any).reasonCode).toBe('RATE_LIMIT_UNDER_ENFORCED');

    // Scoring reflects FAIL and INCONCLUSIVE accurately
    const scores = await calculateScores(tenantA.projectId);
    expect(scores.failedVerifications).toBeGreaterThanOrEqual(1);
    expect(scores.inconclusiveVerifications).toBeGreaterThanOrEqual(1);
    expect(scores.securityScore).toBeLessThan(100);
  });

  it('7. Incorrect or missing policy configuration: missing policy, non-positive RPM, or non-positive latencyMs produce INCONCLUSIVE', async () => {
    // 7a: Route without security_policies row
    const { routeId: policyLessRouteId } = await createRouteWithPolicy({ omitPolicy: true });
    const expNoPol = uuidv4();
    const now = new Date();
    await db.insert(experiments).values({
      id: expNoPol,
      routeId: policyLessRouteId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 200 },
      startedAt: now,
    });
    const noPolVerif = await verifyPolicy(expNoPol, null, now, new Date());
    expect(noPolVerif!.verdict).toBe('INCONCLUSIVE');
    expect((noPolVerif!.observed as any).reasonCode).toBe('MISSING_SECURITY_POLICY');

    // 7b: traffic_burst with rateLimitRpm = 0
    const { routeId: zeroRpmRouteId, policyId: zeroRpmPolicyId } = await createRouteWithPolicy({ rateLimitRpm: 0 });
    const expZeroRpm = uuidv4();
    await db.insert(experiments).values({
      id: expZeroRpm,
      routeId: zeroRpmRouteId,
      type: 'traffic_burst',
      status: 'ANALYZING',
      config: {},
      startedAt: now,
    });
    const zeroRpmVerif = await verifyPolicy(expZeroRpm, zeroRpmPolicyId, now, new Date());
    expect(zeroRpmVerif!.verdict).toBe('INCONCLUSIVE');
    expect((zeroRpmVerif!.observed as any).reasonCode).toBe('INVALID_RATE_LIMIT_POLICY');

    // 7c: latency experiment with latencyMs = -50
    const { routeId: badLatRouteId, policyId: badLatPolicyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expBadLat = uuidv4();
    await db.insert(experiments).values({
      id: expBadLat,
      routeId: badLatRouteId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: -50 },
      startedAt: now,
    });
    const badLatVerif = await verifyPolicy(expBadLat, badLatPolicyId, now, new Date());
    expect(badLatVerif!.verdict).toBe('INCONCLUSIVE');
    expect((badLatVerif!.observed as any).reasonCode).toBe('INVALID_EXPERIMENT_CONFIG');
  });

  it('8. Hardcoded autonomous verdict regressions: WAF disabled fails security-audit, sub-capacity burst is INCONCLUSIVE, and healthy full-verification passes', async () => {
    // 8a: WAF disabled -> SQLi/XSS/Traversal probes return 200 -> WAF check MUST FAIL (not hardcoded passed: true!)
    const { routeId: wafOffRouteId } = await createRouteWithPolicy({
      rateLimitRpm: 60,
      enableWaf: false,
    });
    const wafFailRunId = `run_waffail_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    await db.insert(workflowRuns).values({
      id: wafFailRunId,
      projectId: tenantA.projectId,
      routeId: wafOffRouteId,
      profile: 'security-audit',
      status: 'QUEUED',
      params: { targetUrl: `http://fortix-demo-api.internal:${upstreamPort}/ok`, timeoutMs: 4000 },
      timeline: [],
      cleanupStatus: 'NOT_REQUIRED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await executeAutonomousRun(wafFailRunId);
    const [wafFailRun] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, wafFailRunId));
    const wafVerdict = wafFailRun.deterministicVerdict as any;
    expect(wafVerdict.verdict).toBe('FAIL');
    expect(wafVerdict.passed).toBe(false);
    const wafCheck = wafVerdict.checks.find((c: any) => c.name === 'WAF & Injection Mitigation');
    expect(wafCheck.status).toBe('FAIL');
    expect(wafCheck.passed).toBe(false);
    expect(wafFailRun.status).toBe('RECOVERY_REQUIRED');

    // 8b: Sub-capacity burst (burstRequests: 6 against rateLimitRpm: 50) -> MUST be INCONCLUSIVE (not tautological blockedRequests >= 0!)
    const { routeId: highRpmRouteId } = await createRouteWithPolicy({
      rateLimitRpm: 50,
      enableWaf: true,
    });
    const subBurstRunId = `run_subburst_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    await db.insert(workflowRuns).values({
      id: subBurstRunId,
      projectId: tenantA.projectId,
      routeId: highRpmRouteId,
      profile: 'resilience-stress',
      status: 'QUEUED',
      params: {
        targetUrl: `http://fortix-demo-api.internal:${upstreamPort}/ok`,
        burstRequests: 6,
        timeoutMs: 4000,
      },
      timeline: [],
      cleanupStatus: 'NOT_REQUIRED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await executeAutonomousRun(subBurstRunId);
    const [subBurstRun] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, subBurstRunId));
    const subBurstVerdict = subBurstRun.deterministicVerdict as any;
    expect(subBurstVerdict.verdict).toBe('INCONCLUSIVE');
    expect(subBurstVerdict.passed).toBe(false);
    const rlCheck = subBurstVerdict.checks.find((c: any) => c.name === 'Rate Limit Token Bucket Enforcement');
    expect(rlCheck.status).toBe('INCONCLUSIVE');
    expect(rlCheck.passed).toBe(false);

    // 8c: Properly protected route (enableWaf: true, rateLimitRpm: 12) -> full-verification PASSES end-to-end
    const { routeId: goodRouteId } = await createRouteWithPolicy({
      rateLimitRpm: 12,
      enableWaf: true,
    });
    const passRunId = `run_fullpass_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    await db.insert(workflowRuns).values({
      id: passRunId,
      projectId: tenantA.projectId,
      routeId: goodRouteId,
      profile: 'full-verification',
      status: 'QUEUED',
      params: {
        targetUrl: `http://fortix-demo-api.internal:${upstreamPort}/ok`,
        burstRequests: 28,
        faultDurationMs: 1000,
        timeoutMs: 4000,
      },
      timeline: [],
      cleanupStatus: 'NOT_REQUIRED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await executeAutonomousRun(passRunId);
    const [passRun] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, passRunId));
    const passVerdict = passRun.deterministicVerdict as any;
    expect(passVerdict.verdict).toBe('PASS');
    expect(passVerdict.passed).toBe(true);
    expect(passRun.status).toBe('COMPLETED');
    expect(passRun.cleanupStatus).toBe('CLEANED');

    // Ephemeral worker keys were cleaned up
    const lingeringKeys = await db.select().from(apiKeys).where(eq(apiKeys.projectId, tenantA.projectId));
    expect(lingeringKeys.some((k) => k.name.includes(passRunId.slice(0, 10)))).toBe(false);
  });

  it('9. Baseline measurement: unhealthy pre-fault baseline returns INCONCLUSIVE instead of corrupting fault evaluation', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({
      rateLimitRpm: 60,
      targetPath: '/always-503',
    });
    const expId = uuidv4();
    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'error_5xx',
      status: 'QUEUED',
      config: { durationMs: 600 },
    });

    await runExperimentLogic(expId);

    const [verif] = await db.select().from(verifications).where(eq(verifications.experimentId, expId));
    expect(verif).toBeDefined();
    expect(verif.verdict).toBe('INCONCLUSIVE');
    expect((verif.observed as any).reasonCode).toBe('UNHEALTHY_BASELINE');
    expect((verif.observed as any).phases.baseline.serverError5xx).toBeGreaterThan(0);
  });

  it('10. Injection measurement: runExperimentLogic measures real latency & 503 fault phases without contaminating baseline or recovery', async () => {
    const { routeId } = await createRouteWithPolicy({ rateLimitRpm: 80 });

    // 10a: Latency injection experiment
    const latExpId = uuidv4();
    await db.insert(experiments).values({
      id: latExpId,
      routeId,
      type: 'latency',
      status: 'QUEUED',
      config: { latencyMs: 180, durationMs: 700 },
    });

    await runExperimentLogic(latExpId);

    const [latVerif] = await db.select().from(verifications).where(eq(verifications.experimentId, latExpId));
    expect(latVerif.verdict).toBe('PASS');
    const latObs = latVerif.observed as any;
    expect(latObs.phases.baseline.accepted2xx).toBeGreaterThanOrEqual(3);
    expect(latObs.phases.baseline.avgLatencyMs).toBeLessThan(120);
    expect(latObs.phases.injection.observedCount).toBeGreaterThanOrEqual(5);
    expect(latObs.phases.injection.avgLatencyMs).toBeGreaterThanOrEqual(135);
    expect(latObs.phases.recovery.accepted2xx).toBeGreaterThanOrEqual(3);
    expect(latObs.phases.recovery.avgLatencyMs).toBeLessThan(120);

    // 10b: Error 5xx injection experiment
    const errExpId = uuidv4();
    await db.insert(experiments).values({
      id: errExpId,
      routeId,
      type: 'error_5xx',
      status: 'QUEUED',
      config: { durationMs: 600 },
    });

    await runExperimentLogic(errExpId);

    const [errVerif] = await db.select().from(verifications).where(eq(verifications.experimentId, errExpId));
    expect(errVerif.verdict).toBe('PASS');
    const errObs = errVerif.observed as any;
    expect(errObs.phases.baseline.serverError5xx).toBe(0);
    expect(errObs.phases.injection.serviceUnavailable503).toBe(errObs.phases.injection.observedCount);
    expect(errObs.phases.recovery.serverError5xx).toBe(0);
    expect(errObs.recoveryDurationMs).toBeGreaterThan(0);

    // Resilience summary endpoint serves real phase measurements (never synthetic 2.4s / 92.5%)
    const summaryRes = await request(gatewayApp)
      .get(`/api/control/metrics/resilience-summary?projectId=${tenantA.projectId}`)
      .set('Authorization', `Bearer ${tenantA.token}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.comparison.verdict).toBe('PASS');
    expect(summaryRes.body.gatewayOverhead.directMs).toBeNull();
  });

  it('11. Recovery measurement: persistent post-fault 503 fails verification, and missing recovery window returns INCONCLUSIVE', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const baseStart = new Date(Date.now() - 2000);
    const baseEnd = new Date(Date.now() - 1600);
    const injStart = new Date(Date.now() - 1500);
    const injEnd = new Date(Date.now() - 600);
    const recStart = new Date(Date.now() - 500);
    const recEnd = new Date();

    // 11a: Persistent 503 during RECOVERY -> FAIL (POST_FAULT_RECOVERY_FAILED)
    const expFailRec = uuidv4();
    await db.insert(experiments).values({
      id: expFailRec,
      routeId,
      type: 'error_5xx',
      status: 'ANALYZING',
      config: { durationMs: 800 },
      startedAt: injStart,
    });

    const baseIds = ['rb1', 'rb2', 'rb3'];
    const recIds = ['rr1', 'rr2', 'rr3'];
    await db.insert(metricLogs).values([
      ...baseIds.map((id, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expFailRec,
        requestId: id,
        latencyMs: 12,
        statusCode: 200,
        timestamp: new Date(baseStart.getTime() + i * 20),
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expFailRec,
        requestId: `ri_${i}`,
        latencyMs: 8,
        statusCode: 503,
        timestamp: new Date(injStart.getTime() + i * 40),
      })),
      ...recIds.map((id, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expFailRec,
        requestId: id,
        latencyMs: 14,
        statusCode: 503, // Still failing after fault ended!
        timestamp: new Date(recStart.getTime() + i * 20),
      })),
    ]);

    const failedRecVerif = await verifyPolicy(expFailRec, policyId, injStart, injEnd, {
      phases: {
        baseline: { startTime: baseStart, endTime: baseEnd, requestsSent: 3, requestIds: baseIds },
        injection: { startTime: injStart, endTime: injEnd, requestsSent: 6 },
        recovery: { startTime: recStart, endTime: recEnd, requestsSent: 3, requestIds: recIds },
      },
      requireBaseline: true,
      requireRecovery: true,
    });
    expect(failedRecVerif!.verdict).toBe('FAIL');
    expect((failedRecVerif!.observed as any).reasonCode).toBe('POST_FAULT_RECOVERY_FAILED');

    // 11b: Missing recovery window on resilience experiment -> INCONCLUSIVE (MISSING_RECOVERY_EVIDENCE)
    const expMissingRec = uuidv4();
    await db.insert(experiments).values({
      id: expMissingRec,
      routeId,
      type: 'error_5xx',
      status: 'ANALYZING',
      config: { durationMs: 800 },
      startedAt: injStart,
    });
    await db.insert(metricLogs).values(
      Array.from({ length: 6 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expMissingRec,
        requestId: `mri_${i}`,
        latencyMs: 9,
        statusCode: 503,
        timestamp: new Date(injStart.getTime() + i * 30),
      }))
    );

    const missingRecVerif = await verifyPolicy(expMissingRec, policyId, injStart, injEnd);
    expect(missingRecVerif!.verdict).toBe('INCONCLUSIVE');
    expect((missingRecVerif!.observed as any).reasonCode).toBe('MISSING_RECOVERY_EVIDENCE');
  });

  it('12. Partial telemetry: returns INCONCLUSIVE when persisted observations fall below 80% of dispatched probes', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const start = new Date(Date.now() - 800);
    const end = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'latency',
      status: 'ANALYZING',
      config: { latencyMs: 150 },
      startedAt: start,
    });

    // 10 persisted out of 20 sent (50% < 80% threshold)
    await db.insert(metricLogs).values(
      Array.from({ length: 10 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: `part_${expId}_${i}`,
        latencyMs: 165,
        statusCode: 200,
        timestamp: new Date(start.getTime() + i * 25),
      }))
    );

    const verif = await verifyPolicy(expId, policyId, start, end, {
      phases: {
        injection: { startTime: start, endTime: end, requestsSent: 20 },
      },
      requireRecovery: false,
    });

    expect(verif!.verdict).toBe('INCONCLUSIVE');
    expect((verif!.observed as any).reasonCode).toBe('PARTIAL_TELEMETRY_LOSS');
  });

  it('13. Duplicate telemetry events: deduplicates repeated requestId entries so replayed 429 rows cannot mask rate-limit breaches', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 10 });
    const expId = uuidv4();
    const start = new Date(Date.now() - 400);
    const end = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'traffic_burst',
      status: 'ANALYZING',
      config: {},
      startedAt: start,
    });

    // 13 unique 200s (exceeding maxAllowedAccepted=11 for RPM=10) + 1 unique 429 replayed 15 times with same requestId
    await db.insert(metricLogs).values([
      ...Array.from({ length: 13 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: `uniq_200_${i}`,
        latencyMs: 14,
        statusCode: 200,
        timestamp: new Date(start.getTime() + i * 10),
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: 'replayed_single_429_req_id',
        latencyMs: 5,
        statusCode: 429,
        timestamp: new Date(start.getTime() + 150 + i * 5),
      })),
    ]);

    const dedupCheck = deduplicateMetrics([
      { id: '1', requestId: 'same', latencyMs: 10, statusCode: 200 },
      { id: '2', requestId: 'same', latencyMs: 10, statusCode: 200 },
      { id: '3', requestId: 'bad', latencyMs: -5, statusCode: 999 },
    ]);
    expect(dedupCheck.validRows).toHaveLength(1);
    expect(dedupCheck.duplicateDroppedCount).toBe(1);
    expect(dedupCheck.malformedDroppedCount).toBe(1);

    const verif = await verifyPolicy(expId, policyId, start, end, { requireRecovery: false });
    expect(verif!.verdict).toBe('FAIL');
    const obs = verif!.observed as any;
    expect(obs.phases.injection.duplicateDroppedCount).toBe(14);
    expect(obs.accepted).toBe(13);
    expect(obs.rejected).toBe(1);
  });

  it('14. Experiment cancellation & cleanup: cancelling an active experiment clears gateway faults immediately and persists INCONCLUSIVE', async () => {
    const { routeId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'error_5xx',
      status: 'RUNNING',
      config: { durationMs: 8000 },
      startedAt: new Date(),
    });
    invalidateExpCache(routeId);

    // Fault is active (503)
    const duringFault = await request(gatewayApp)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', tenantA.rawApiKey);
    expect(duringFault.status).toBe(503);

    // Cancel via control plane API
    const cancelRes = await request(gatewayApp)
      .post(`/api/control/experiments/${expId}/cancel`)
      .set('Authorization', `Bearer ${tenantA.token}`)
      .send({ projectId: tenantA.projectId });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.experiment.status).toBe('CANCELLED');
    expect(cancelRes.body.verification.verdict).toBe('INCONCLUSIVE');
    expect(cancelRes.body.verification.observed.reasonCode).toBe('EXPERIMENT_CANCELLED');

    // Gateway fault is immediately cleared (200 OK)
    const afterCancel = await request(gatewayApp)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', tenantA.rawApiKey);
    expect(afterCancel.status).toBe(200);
  });

  it('15. Concurrent verification attempts: parallel verifyPolicy calls are serialized and persist exactly one verification row', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const start = new Date(Date.now() - 500);
    const end = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'error_5xx',
      status: 'ANALYZING',
      config: { durationMs: 500 },
      startedAt: start,
    });

    const recIds = ['conc_r1', 'conc_r2', 'conc_r3'];
    await db.insert(metricLogs).values([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: `conc_i_${i}`,
        latencyMs: 9,
        statusCode: 503,
        timestamp: new Date(start.getTime() + i * 20),
      })),
      ...recIds.map((rid, i) => ({
        id: uuidv4(),
        routeId,
        experimentId: expId,
        requestId: rid,
        latencyMs: 12,
        statusCode: 200,
        timestamp: new Date(end.getTime() + i * 10),
      })),
    ]);

    const opts = {
      phases: {
        injection: { startTime: start, endTime: end, requestsSent: 6 },
        recovery: {
          startTime: end,
          endTime: new Date(end.getTime() + 100),
          requestsSent: 3,
          requestIds: recIds,
        },
      },
      recoveryDurationMs: 15,
      requireRecovery: true,
    };

    const parallelResults = await Promise.all([
      verifyPolicy(expId, policyId, start, end, opts),
      verifyPolicy(expId, policyId, start, end, opts),
      verifyPolicy(expId, policyId, start, end, opts),
      verifyPolicy(expId, policyId, start, end, opts),
    ]);

    const ids = new Set(parallelResults.map((r) => r!.id));
    expect(ids.size).toBe(1);

    const rowsInDb = await db.select().from(verifications).where(eq(verifications.experimentId, expId));
    expect(rowsInDb).toHaveLength(1);
    expect(rowsInDb[0].verdict).toBe('PASS');
  });

  it('16. Tenant isolation & authorization: foreign tenants are blocked with 403 across verifications, experiment cancel, runs, and reports', async () => {
    const { routeId, policyId } = await createRouteWithPolicy({ rateLimitRpm: 60 });
    const expId = uuidv4();
    const now = new Date();

    await db.insert(experiments).values({
      id: expId,
      routeId,
      type: 'latency',
      status: 'RUNNING',
      config: { latencyMs: 200 },
      startedAt: now,
    });

    const verif = await verifyPolicy(expId, policyId, now, new Date());
    expect(verif).not.toBeNull();

    // Owner (Tenant A) can read verification by ID and list
    const ownerGet = await request(gatewayApp)
      .get(`/api/control/verifications/${verif!.id}`)
      .set('Authorization', `Bearer ${tenantA.token}`);
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.verdict).toBe('INCONCLUSIVE');

    // Foreign user (Tenant B) is rejected with 403 on list, detail, cancel, runs, and PDF report
    const foreignList = await request(gatewayApp)
      .get(`/api/control/verifications?projectId=${tenantA.projectId}`)
      .set('Authorization', `Bearer ${tenantB.token}`);
    expect(foreignList.status).toBe(403);

    const foreignDetail = await request(gatewayApp)
      .get(`/api/control/verifications/${verif!.id}`)
      .set('Authorization', `Bearer ${tenantB.token}`);
    expect(foreignDetail.status).toBe(403);

    const foreignCancel = await request(gatewayApp)
      .post(`/api/control/experiments/${expId}/cancel`)
      .set('Authorization', `Bearer ${tenantB.token}`)
      .send({ projectId: tenantB.projectId });
    expect(foreignCancel.status).toBe(403);

    const foreignReport = await request(gatewayApp)
      .post(`/api/control/reports/${verif!.id}`)
      .set('Authorization', `Bearer ${tenantB.token}`)
      .send({ projectId: tenantB.projectId });
    expect(foreignReport.status).toBe(403);

    const foreignRuns = await request(gatewayApp)
      .get(`/api/control/runs?projectId=${tenantA.projectId}`)
      .set('Authorization', `Bearer ${tenantB.token}`);
    expect(foreignRuns.status).toBe(403);

    // Pure helper sanity check: computePhaseMetrics never fabricates percentiles below 5 samples
    const fourSamples = computePhaseMetrics('INJECTION', [
      { id: 'a', latencyMs: 10, statusCode: 200 },
      { id: 'b', latencyMs: 20, statusCode: 200 },
      { id: 'c', latencyMs: 30, statusCode: 200 },
      { id: 'd', latencyMs: 40, statusCode: 200 },
    ]);
    expect(fourSamples.percentiles).toBeNull();
  });
});
