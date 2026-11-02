import { db } from '../db/index.js';
import { experiments, apiRoutes, securityPolicies, apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyPolicy, PhaseExecutionWindow } from '../verification/engine.js';
import { invalidateApiKeyCache, invalidateExpCache } from '../gateway/index.js';
import { resolveGatewayPort } from '../lib/port.js';
import { logger } from '../lib/logger.js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config();

const MAX_WORKER_BURST_REQUESTS = 150;
const BASELINE_PROBE_COUNT = 5;
const RECOVERY_PROBE_COUNT = 5;

async function generateTempApiKey(projectId: string, label: string) {
  const keyId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = await bcrypt.hash(secret, 10);
  const keyPrefix = `fx_test_${keyId}`;

  await db.insert(apiKeys).values({
    id: keyId,
    projectId,
    keyPrefix,
    name: `Experiment Worker Key (${label})`,
    secretHash,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
    createdAt: new Date(),
  });

  return { id: keyId, raw: `${keyPrefix}_${secret}` };
}

async function isExperimentCancelled(experimentId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: experiments.status })
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .limit(1);
  return !row || row.status === 'CANCELLED';
}

async function sendProbeRequest(
  targetUrl: string,
  headers: Record<string, string>,
  probeId: string,
  timeoutMs = 7000
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, {
      headers: {
        ...headers,
        'x-fortix-probe-id': probeId,
      },
      signal: controller.signal,
    });
    return res.status;
  } catch (e) {
    logger.debug({ err: e, probeId }, '[ExperimentWorker] Probe request error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runFixedProbeBatch(params: {
  targetUrl: string;
  expId: string;
  rawApiKey: string;
  phasePrefix: string;
  count: number;
}): Promise<{ window: PhaseExecutionWindow; firstSuccessLatencyMs: number | null; cancelled: boolean }> {
  const { targetUrl, expId, rawApiKey, phasePrefix, count } = params;
  const startTime = new Date();
  const phaseStartPerf = Date.now();
  const requestIds: string[] = [];
  let requestsSent = 0;
  let firstSuccessLatencyMs: number | null = null;
  let cancelled = false;

  const headers: Record<string, string> = {
    'x-experiment-id': expId,
    'x-api-key': rawApiKey,
  };

  for (let i = 1; i <= count; i++) {
    if (await isExperimentCancelled(expId)) {
      cancelled = true;
      break;
    }
    const probeId = `${phasePrefix}_${expId.slice(0, 12)}_${i}`;
    requestIds.push(probeId);
    requestsSent++;
    const status = await sendProbeRequest(targetUrl, headers, probeId, 5000);
    if (firstSuccessLatencyMs === null && status !== null && status >= 200 && status < 300) {
      firstSuccessLatencyMs = Math.max(1, Date.now() - phaseStartPerf);
    }
  }

  return {
    window: {
      startTime,
      endTime: new Date(),
      requestsSent,
      requestIds,
    },
    firstSuccessLatencyMs,
    cancelled,
  };
}

async function runInjectionWorkload(params: {
  targetUrl: string;
  expId: string;
  expType: string;
  durationMs: number;
  rawApiKey: string;
  rateLimitRpm?: number | null;
}): Promise<{ window: PhaseExecutionWindow; cancelled: boolean }> {
  const { targetUrl, expId, expType, durationMs, rawApiKey, rateLimitRpm } = params;
  const startTime = new Date();
  const deadline = Date.now() + durationMs;
  const requestIds: string[] = [];
  let requestsSent = 0;
  let cancelled = false;

  const headers: Record<string, string> = {
    'x-experiment-id': expId,
    'x-api-key': rawApiKey,
  };

  if (expType === 'traffic_burst' || expType === 'rate_limit') {
    const desiredCount =
      typeof rateLimitRpm === 'number' && rateLimitRpm > 0
        ? Math.min(MAX_WORKER_BURST_REQUESTS, Math.max(30, rateLimitRpm + 15))
        : 35;

    const concurrency = 10;
    while (requestsSent < desiredCount && Date.now() < deadline) {
      if (await isExperimentCancelled(expId)) {
        cancelled = true;
        break;
      }
      const batchSize =
        requestsSent === 0 ? 1 : Math.min(concurrency, desiredCount - requestsSent);
      const batchPromises: Promise<number | null>[] = [];
      for (let b = 0; b < batchSize; b++) {
        requestsSent++;
        const probeId = `inj_${expId.slice(0, 12)}_${requestsSent}`;
        requestIds.push(probeId);
        batchPromises.push(sendProbeRequest(targetUrl, headers, probeId, 6000));
      }
      await Promise.all(batchPromises);
    }
  } else {
    // Resilience fault experiments (latency, error_5xx, timeout): collect >= 6 probes via small waves
    // so multi-hundred-ms latency/timeout faults still achieve sample sufficiency within durationMs,
    // then hold the fault window active until deadline (unless cancelled).
    const minTargetProbes = 6;
    const maxProbes = 18;
    const waveSize = 5;

    while (requestsSent < minTargetProbes && Date.now() < deadline) {
      if (await isExperimentCancelled(expId)) {
        cancelled = true;
        break;
      }
      const batchCount =
        requestsSent === 0 ? 1 : Math.min(waveSize, minTargetProbes - requestsSent);
      const wavePromises: Promise<number | null>[] = [];
      for (let w = 0; w < batchCount; w++) {
        requestsSent++;
        const probeId = `inj_${expId.slice(0, 12)}_${requestsSent}`;
        requestIds.push(probeId);
        wavePromises.push(sendProbeRequest(targetUrl, headers, probeId, 7000));
      }
      await Promise.all(wavePromises);
    }

    let nextPeriodicProbeAt = Date.now() + 900;
    while (!cancelled && Date.now() < deadline) {
      if (await isExperimentCancelled(expId)) {
        cancelled = true;
        break;
      }
      if (requestsSent < maxProbes && Date.now() >= nextPeriodicProbeAt) {
        requestsSent++;
        const probeId = `inj_${expId.slice(0, 12)}_${requestsSent}`;
        requestIds.push(probeId);
        await sendProbeRequest(targetUrl, headers, probeId, 7000);
        nextPeriodicProbeAt = Date.now() + 900;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(100, remainingMs)));
    }
  }

  return {
    window: {
      startTime,
      endTime: new Date(),
      requestsSent,
      requestIds,
    },
    cancelled,
  };
}

export async function runExperimentLogic(experimentId: string) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId)).limit(1);
  if (!exp) {
    throw new Error(`Experiment '${experimentId}' not found`);
  }

  if (exp.status === 'CANCELLED') {
    invalidateExpCache(exp.routeId);
    const now = new Date();
    await verifyPolicy(exp.id, null, now, now);
    return;
  }

  const [route] = await db.select().from(apiRoutes).where(eq(apiRoutes.id, exp.routeId)).limit(1);

  if (!route) {
    await db.update(experiments).set({ status: 'FAILED', completedAt: new Date() }).where(eq(experiments.id, experimentId));
    invalidateExpCache(exp.routeId);
    throw new Error(`Route '${exp.routeId}' for experiment '${experimentId}' not found`);
  }

  const [policy] = await db.select().from(securityPolicies).where(eq(securityPolicies.routeId, exp.routeId)).limit(1);

  const gatewayPort = resolveGatewayPort();
  const target = `http://127.0.0.1:${gatewayPort}/proxy/${route.id}`;
  const allocatedKeys: Array<{ id: string; raw: string }> = [];

  try {
    // Provision isolated ephemeral keys per phase so BASELINE/INJECTION/RECOVERY token buckets do not cross-contaminate
    const baselineKey = await generateTempApiKey(route.projectId, 'baseline');
    allocatedKeys.push(baselineKey);
    const injectionKey = await generateTempApiKey(route.projectId, 'injection');
    allocatedKeys.push(injectionKey);

    // Phase 1: BASELINE (fault NOT yet active; status = BASELINE)
    if (await isExperimentCancelled(experimentId)) {
      invalidateExpCache(exp.routeId);
      const now = new Date();
      await verifyPolicy(exp.id, policy?.id ?? null, now, now);
      return;
    }

    await db.update(experiments).set({ status: 'BASELINE', startedAt: new Date() }).where(eq(experiments.id, experimentId));
    invalidateExpCache(exp.routeId);

    const baselineRes = await runFixedProbeBatch({
      targetUrl: target,
      expId: exp.id,
      rawApiKey: baselineKey.raw,
      phasePrefix: 'base',
      count: BASELINE_PROBE_COUNT,
    });

    if (baselineRes.cancelled || (await isExperimentCancelled(experimentId))) {
      invalidateExpCache(exp.routeId);
      await verifyPolicy(exp.id, policy?.id ?? null, baselineRes.window.startTime, new Date(), {
        phases: { baseline: baselineRes.window },
        requireBaseline: true,
        requireRecovery: true,
      });
      return;
    }

    // Phase 2: INJECTION (activate gateway fault strictly by transitioning status -> RUNNING)
    await db.update(experiments).set({ status: 'RUNNING' }).where(eq(experiments.id, experimentId));
    invalidateExpCache(exp.routeId);

    const expDuration = Math.min(Math.max(Number((exp.config as any)?.durationMs || 5000), 500), 10000);
    const injectionRes = await runInjectionWorkload({
      targetUrl: target,
      expId: exp.id,
      expType: exp.type,
      durationMs: expDuration,
      rawApiKey: injectionKey.raw,
      rateLimitRpm: policy?.rateLimitRpm,
    });

    // Immediately deactivate fault before RECOVERY probes
    if (injectionRes.cancelled || (await isExperimentCancelled(experimentId))) {
      invalidateExpCache(exp.routeId);
      await verifyPolicy(exp.id, policy?.id ?? null, injectionRes.window.startTime, new Date(), {
        phases: {
          baseline: baselineRes.window,
          injection: injectionRes.window,
        },
        requireBaseline: true,
        requireRecovery: true,
      });
      return;
    }

    await db.update(experiments).set({ status: 'OBSERVING' }).where(eq(experiments.id, experimentId));
    invalidateExpCache(exp.routeId);

    const recoveryKey = await generateTempApiKey(route.projectId, 'recovery');
    allocatedKeys.push(recoveryKey);

    // Phase 3: RECOVERY (fault removed; measure clean restoration & recoveryDurationMs)
    const recoveryRes = await runFixedProbeBatch({
      targetUrl: target,
      expId: exp.id,
      rawApiKey: recoveryKey.raw,
      phasePrefix: 'rec',
      count: RECOVERY_PROBE_COUNT,
    });

    if (recoveryRes.cancelled || (await isExperimentCancelled(experimentId))) {
      invalidateExpCache(exp.routeId);
      await verifyPolicy(exp.id, policy?.id ?? null, injectionRes.window.startTime, new Date(), {
        phases: {
          baseline: baselineRes.window,
          injection: injectionRes.window,
          recovery: recoveryRes.window,
        },
        recoveryDurationMs: recoveryRes.firstSuccessLatencyMs,
        requireBaseline: true,
        requireRecovery: true,
      });
      return;
    }

    // Phase 4: ANALYZING & DETERMINISTIC VERIFICATION (always executed even when policy is missing -> INCONCLUSIVE)
    await db.update(experiments).set({ status: 'ANALYZING' }).where(eq(experiments.id, experimentId));
    invalidateExpCache(exp.routeId);

    await verifyPolicy(exp.id, policy?.id ?? null, injectionRes.window.startTime, injectionRes.window.endTime, {
      phases: {
        baseline: baselineRes.window,
        injection: injectionRes.window,
        recovery: recoveryRes.window,
      },
      recoveryDurationMs: recoveryRes.firstSuccessLatencyMs,
      requireBaseline: true,
      requireRecovery: true,
    });

    if (!(await isExperimentCancelled(experimentId))) {
      await db
        .update(experiments)
        .set({ status: 'COMPLETED', completedAt: new Date() })
        .where(eq(experiments.id, experimentId));
    }
    invalidateExpCache(exp.routeId);
  } catch (error) {
    logger.error({ err: error, experimentId }, '[ExperimentWorker] Experiment execution failed');
    if (!(await isExperimentCancelled(experimentId))) {
      await db
        .update(experiments)
        .set({ status: 'FAILED', completedAt: new Date() })
        .where(eq(experiments.id, experimentId));
    }
    invalidateExpCache(exp.routeId);
    throw error;
  } finally {
    for (const k of allocatedKeys) {
      try {
        await db.delete(apiKeys).where(eq(apiKeys.id, k.id));
      } catch {}
      invalidateApiKeyCache(k.id, route.projectId);
    }
    invalidateExpCache(exp.routeId);
  }
}
