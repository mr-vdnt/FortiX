import { db } from '../db/index.js';
import {
  workflowRuns,
  apiRoutes,
  apiKeys,
  metricLogs,
  securityEvents,
  experiments,
  securityPolicies,
} from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { isSafeTarget } from '../gateway/ssrf.js';
import { invalidateExpCache, invalidateApiKeyCache } from '../gateway/index.js';
import { analyzeRunEvidence, RunEvidenceContext } from '../ai/analyzer.js';
import { artifactStorage } from '../storage/index.js';
import { buildPdfBuffer } from '../api/reports.js';
import { broadcast } from '../socket.js';
import { transitionWorkflowStatus, WorkflowStatus, InvalidStateTransitionError } from './stateMachine.js';
import { resolveGatewayPort } from '../lib/port.js';
import { flushTelemetryBarrier, TelemetrySyncResult } from '../lib/telemetry.js';
import {
  VerificationVerdict,
  PhaseWindowMetrics,
  computePhaseMetrics,
  evaluateRateLimitRule,
  aggregateVerdicts,
  MIN_BASELINE_SAMPLES,
  MIN_RECOVERY_SAMPLES,
  MIN_PERCENTILE_SAMPLES,
} from '../verification/domain.js';

export type { WorkflowStatus };
export type WorkflowProfile = 'security-audit' | 'resilience-stress' | 'failover-recovery' | 'full-verification';

export interface TimelineEntry {
  timestamp: string;
  stage: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  details?: Record<string, any>;
}

export interface DeterministicCheck {
  name: string;
  category: 'TELEMETRY' | 'BASELINE' | 'SECURITY' | 'RESILIENCE' | 'SLA' | 'RECOVERY';
  status: VerificationVerdict;
  passed: boolean;
  observed: string | number;
  threshold: string | number;
  evidenceRef: string;
  reason?: string;
}

export interface DeterministicVerdict {
  verdict: VerificationVerdict;
  passed: boolean;
  score: number;
  checks: DeterministicCheck[];
  latencyPercentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  } | null;
  errorRate: number | null;
  recoveryDurationMs: number | null;
  telemetrySync: TelemetrySyncResult;
  phases: {
    baseline: PhaseWindowMetrics | null;
    injection: PhaseWindowMetrics | null;
    recovery: PhaseWindowMetrics | null;
  };
  totalDurationMs: number;
}

/**
 * Creates and validates a new autonomous workflow run.
 */
export async function createAutonomousWorkflowRun(params: {
  userId: string;
  projectId: string;
  routeId: string;
  profile: WorkflowProfile;
  customConfig?: {
    burstRequests?: number;
    timeoutMs?: number;
    faultDurationMs?: number;
  };
}) {
  const { projectId, routeId, profile, customConfig } = params;

  // 1. Verify Route and Project ownership
  const [route] = await db
    .select()
    .from(apiRoutes)
    .where(and(eq(apiRoutes.id, routeId), eq(apiRoutes.projectId, projectId)))
    .limit(1);

  if (!route) {
    throw new Error('Route not found or does not belong to specified project');
  }

  // 2. Validate Target URL & SSRF blast radius
  if (!isSafeTarget(route.targetUrl)) {
    throw new Error(`Target URL ${route.targetUrl} violates SSRF / safe-target policy`);
  }

  const runId = `run_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const initialTimeline: TimelineEntry[] = [
    {
      timestamp: new Date().toISOString(),
      stage: 'QUEUED',
      level: 'INFO',
      message: `Workflow run initialized with profile '${profile}' for route ${route.pathPattern}`,
      details: { routeId, targetUrl: route.targetUrl },
    },
  ];

  const runParams = {
    profile,
    targetUrl: route.targetUrl,
    routePath: route.pathPattern,
    burstRequests:
      customConfig?.burstRequests !== undefined ? Math.min(Math.max(1, customConfig.burstRequests), 100) : null,
    timeoutMs: Math.min(customConfig?.timeoutMs || 5000, 30000),
    faultDurationMs: Math.min(customConfig?.faultDurationMs || 3000, 10000),
  };

  const [newRun] = await db
    .insert(workflowRuns)
    .values({
      id: runId,
      projectId,
      routeId,
      profile,
      status: 'QUEUED',
      params: runParams,
      timeline: initialTimeline,
      cleanupStatus: 'NOT_REQUIRED',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  broadcast(projectId, 'workflow:run:queued', { runId, status: 'QUEUED' });

  // Start autonomous worker asynchronously
  const launchTimer = setTimeout(() => {
    executeAutonomousRun(runId).catch((err) => {
      console.error(`[AutonomousEngine] Fatal error executing run ${runId}:`, err);
    });
  }, 50);
  launchTimer.unref?.();

  return newRun;
}

/**
 * Appends a timeline event and updates database state.
 */
async function appendTimeline(runId: string, entry: TimelineEntry) {
  try {
    const [existing] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!existing || existing.status === 'CANCELLED') return;

    const timeline = Array.isArray(existing.timeline) ? [...existing.timeline, entry] : [entry];
    await db
      .update(workflowRuns)
      .set({
        timeline,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));

    broadcast(existing.projectId, 'workflow:run:timeline', {
      runId,
      stage: entry.stage,
      message: entry.message,
      level: entry.level,
      timestamp: entry.timestamp,
    });
  } catch (err) {
    console.error(`Failed to append timeline for run ${runId}:`, err);
  }
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);
  return !row || row.status === 'CANCELLED';
}

/**
 * Transition state safely and idempotently via durable state machine.
 */
async function transitionRunStatus(runId: string, status: WorkflowStatus, extraUpdates: Record<string, any> = {}) {
  const result = await transitionWorkflowStatus(runId, status, { extraUpdates });
  return result.run;
}

/**
 * Creates temporary credentials dedicated to an autonomous run phase for authenticated execution.
 */
async function createRunApiKey(projectId: string, runId: string, phaseLabel: string) {
  const keyId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const keyPrefix = `fx_test_${keyId}`;
  const rawKey = `${keyPrefix}_${secret}`;
  const secretHash = await bcrypt.hash(secret, 10);

  await db.insert(apiKeys).values({
    id: keyId,
    projectId,
    keyPrefix,
    secretHash,
    name: `Autonomous Run Worker (${runId.slice(0, 10)}) [${phaseLabel}]`,
    purpose: 'Automated resilience & security probe execution',
    scopes: ['gateway:proxy', 'metrics:read'],
    expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    createdAt: new Date(),
  });

  return { keyId, rawKey };
}

async function sendRunProbe(
  url: string,
  headers: Record<string, string>,
  probeId: string,
  timeoutMs = 6000
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        ...headers,
        'x-fortix-probe-id': probeId,
      },
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main Autonomous Execution Lifecycle Worker.
 */
export async function executeAutonomousRun(runId: string) {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  if (!run || run.status !== 'QUEUED') return;

  const projectId = run.projectId;
  const routeId = run.routeId;
  const profile = run.profile as WorkflowProfile;
  const params = (run.params as any) || {};

  const [route] = await db.select().from(apiRoutes).where(eq(apiRoutes.id, routeId)).limit(1);
  if (!route) {
    await transitionRunStatus(runId, 'FAILED', { errorMessage: 'Route was deleted prior to execution' });
    return;
  }

  const startTime = new Date();
  try {
    await transitionRunStatus(runId, 'RUNNING', { startedAt: startTime });
  } catch (err: any) {
    if (err instanceof InvalidStateTransitionError) {
      return;
    }
    throw err;
  }

  await appendTimeline(runId, {
    timestamp: new Date().toISOString(),
    stage: 'RUNNING',
    level: 'INFO',
    message: 'Autonomous execution started. Provisioning isolated phase credentials and initializing probes.',
  });

  const allocatedKeys: Array<{ keyId: string; rawKey: string }> = [];
  const createdExperimentIds: string[] = [];

  try {
    const [routePolicy] = await db
      .select()
      .from(securityPolicies)
      .where(eq(securityPolicies.routeId, routeId))
      .limit(1);

    const baselineKey = await createRunApiKey(projectId, runId, 'baseline');
    allocatedKeys.push(baselineKey);
    const injectionKey = await createRunApiKey(projectId, runId, 'injection');
    allocatedKeys.push(injectionKey);
    const recoveryKey = await createRunApiKey(projectId, runId, 'recovery');
    allocatedKeys.push(recoveryKey);

    await appendTimeline(runId, {
      timestamp: new Date().toISOString(),
      stage: 'AUTH_PROVISION',
      level: 'INFO',
      message: `Provisioned phase-isolated ephemeral FortiX credentials (${baselineKey.rawKey.slice(0, 16)}...).`,
    });

    if (await isRunCancelled(runId)) return;

    const port = resolveGatewayPort();
    const proxyUrl = `http://127.0.0.1:${port}/proxy/${routeId}`;

    // =========================================================================
    // PHASE 1: BASELINE OBSERVATION (Pre-Fault / Pre-Burst Reference)
    // =========================================================================
    const baselineStart = new Date();
    const baselineProbeIds: string[] = [];
    const baselineProbeCount = 5;

    await appendTimeline(runId, {
      timestamp: baselineStart.toISOString(),
      stage: 'BASELINE',
      level: 'INFO',
      message: `Measuring pre-injection baseline across ${baselineProbeCount} authenticated probes...`,
    });

    for (let i = 1; i <= baselineProbeCount; i++) {
      if (await isRunCancelled(runId)) return;
      const probeId = `run_base_${runId}_${i}`;
      baselineProbeIds.push(probeId);
      await sendRunProbe(
        proxyUrl,
        {
          'x-api-key': baselineKey.rawKey,
          'x-fortix-run-id': runId,
        },
        probeId,
        params.timeoutMs || 5000
      );
    }
    const baselineEnd = new Date();

    // =========================================================================
    // PHASE 2: ACTIVE PROBING & FAULT INJECTION
    // =========================================================================
    const injectionStart = new Date();
    const securityProbeIds: string[] = [];
    const securityProbeOutcomes: Array<{
      id: string;
      name: string;
      kind: 'waf' | 'auth';
      expectedStatus: number;
      actualStatus: number | null;
    }> = [];

    if (profile === 'security-audit' || profile === 'full-verification') {
      if (await isRunCancelled(runId)) return;
      await appendTimeline(runId, {
        timestamp: new Date().toISOString(),
        stage: 'SECURITY_PROBES',
        level: 'INFO',
        message: 'Executing WAF threat mitigation and API-key authentication verification probes...',
      });

      const threatProbes = [
        {
          id: `run_sec_sqli_${runId}`,
          name: 'SQL Injection Probe',
          kind: 'waf' as const,
          expectedStatus: 403,
          header: { 'User-Agent': "Mozilla/5.0 ' OR 1=1 --" },
          path: '?query=admin%27%20OR%201=1--',
        },
        {
          id: `run_sec_xss_${runId}`,
          name: 'Cross-Site Scripting Probe',
          kind: 'waf' as const,
          expectedStatus: 403,
          header: { 'X-Probe': '<script>alert("fortix")</script>' },
          path: '?payload=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
        },
        {
          id: `run_sec_traversal_${runId}`,
          name: 'Path Traversal Probe',
          kind: 'waf' as const,
          expectedStatus: 403,
          header: {},
          path: '?file=..%2F..%2F..%2F..%2Fetc%2Fpasswd',
        },
        {
          id: `run_sec_badkey_${runId}`,
          name: 'Invalid API Key Probe',
          kind: 'auth' as const,
          expectedStatus: 401,
          header: { 'x-api-key': 'fx_test_00000000deadbeef_invalidsecretvalue00000000000000' },
          path: '',
        },
      ];

      for (const probe of threatProbes) {
        if (await isRunCancelled(runId)) return;
        if (probe.kind === 'waf') {
          securityProbeIds.push(probe.id);
        }
        const status = await sendRunProbe(
          `${proxyUrl}${probe.path}`,
          {
            'x-api-key': injectionKey.rawKey,
            'x-fortix-run-id': runId,
            ...probe.header,
          },
          probe.id,
          params.timeoutMs || 5000
        );

        securityProbeOutcomes.push({
          id: probe.id,
          name: probe.name,
          kind: probe.kind,
          expectedStatus: probe.expectedStatus,
          actualStatus: status,
        });

        await appendTimeline(runId, {
          timestamp: new Date().toISOString(),
          stage: 'SECURITY_PROBES',
          level: status === probe.expectedStatus ? 'SUCCESS' : 'WARN',
          message: `${probe.name}: Gateway returned HTTP ${status ?? 'ERR'} (expected ${probe.expectedStatus})`,
          details: { probe: probe.name, statusCode: status, expectedStatus: probe.expectedStatus },
        });
      }
    }

    let burstStart: Date | null = null;
    let burstEnd: Date | null = null;
    const burstProbeIds: string[] = [];
    let burstRequestsSent = 0;

    if (profile === 'resilience-stress' || profile === 'full-verification') {
      if (await isRunCancelled(runId)) return;

      const defaultBurst =
        routePolicy?.rateLimitRpm && routePolicy.rateLimitRpm > 0 && routePolicy.rateLimitRpm <= 85
          ? Math.min(100, Math.max(30, routePolicy.rateLimitRpm + 15))
          : 35;
      const burstCount =
        typeof params.burstRequests === 'number' && params.burstRequests > 0
          ? Math.min(params.burstRequests, 100)
          : defaultBurst;

      burstStart = new Date();
      await appendTimeline(runId, {
        timestamp: burstStart.toISOString(),
        stage: 'LOAD_BENCHMARK',
        level: 'INFO',
        message: `Dispatching burst workload of ${burstCount} requests against route token bucket...`,
      });

      const burstKey = await createRunApiKey(projectId, runId, 'burst');
      allocatedKeys.push(burstKey);

      const batchSize = 10;
      const statuses: Array<number | null> = [];
      while (burstRequestsSent < burstCount) {
        if (await isRunCancelled(runId)) return;
        const countNow = Math.min(batchSize, burstCount - burstRequestsSent);
        const batchPromises: Promise<number | null>[] = [];
        for (let b = 0; b < countNow; b++) {
          burstRequestsSent++;
          const probeId = `run_burst_${runId}_${burstRequestsSent}`;
          burstProbeIds.push(probeId);
          batchPromises.push(
            sendRunProbe(
              proxyUrl,
              {
                'x-api-key': burstKey.rawKey,
                'x-fortix-run-id': runId,
              },
              probeId,
              params.timeoutMs || 5000
            )
          );
        }
        const batchRes = await Promise.all(batchPromises);
        statuses.push(...batchRes);
      }
      burstEnd = new Date();

      const passedCount = statuses.filter((s) => s !== null && s >= 200 && s < 300).length;
      const rateLimitedCount = statuses.filter((s) => s === 429).length;

      await appendTimeline(runId, {
        timestamp: burstEnd.toISOString(),
        stage: 'LOAD_BENCHMARK',
        level: 'INFO',
        message: `Burst completed: ${passedCount} accepted (2xx), ${rateLimitedCount} rate-limited (429).`,
        details: { totalSent: burstRequestsSent, passedCount, rateLimitedCount },
      });
    }

    let faultStart: Date | null = null;
    let faultEnd: Date | null = null;
    const faultProbeIds: string[] = [];
    let faultProbesSent = 0;

    if (profile === 'failover-recovery' || profile === 'full-verification') {
      if (await isRunCancelled(runId)) return;
      faultStart = new Date();
      await appendTimeline(runId, {
        timestamp: faultStart.toISOString(),
        stage: 'FAULT_INJECTION',
        level: 'INFO',
        message: 'Injecting controlled 503 upstream fault to verify fault containment...',
      });

      const expId = uuidv4();
      createdExperimentIds.push(expId);
      await db.insert(experiments).values({
        id: expId,
        routeId,
        type: 'error_5xx',
        status: 'RUNNING',
        config: { durationMs: params.faultDurationMs || 2000 },
        startedAt: faultStart,
      });
      invalidateExpCache(routeId);

      const faultKey = await createRunApiKey(projectId, runId, 'fault');
      allocatedKeys.push(faultKey);

      const faultTargetProbes = 5;
      for (let i = 1; i <= faultTargetProbes; i++) {
        if (await isRunCancelled(runId)) return;
        faultProbesSent++;
        const probeId = `run_fault_${runId}_${i}`;
        faultProbeIds.push(probeId);
        await sendRunProbe(
          proxyUrl,
          {
            'x-api-key': faultKey.rawKey,
            'x-fortix-run-id': runId,
          },
          probeId,
          params.timeoutMs || 5000
        );
      }

      faultEnd = new Date();

      // Remove fault immediately prior to RECOVERY phase
      await db
        .update(experiments)
        .set({ status: 'COMPLETED', completedAt: faultEnd })
        .where(eq(experiments.id, expId));
      invalidateExpCache(routeId);
    }

    const injectionEnd = new Date();

    // =========================================================================
    // PHASE 3: POST-INJECTION RECOVERY VERIFICATION
    // =========================================================================
    if (await isRunCancelled(runId)) return;

    const recoveryStart = new Date();
    const recoveryStartPerf = Date.now();
    const recoveryProbeIds: string[] = [];
    const recoveryProbeCount = 5;
    let recoveryDurationMs: number | null = null;

    await appendTimeline(runId, {
      timestamp: recoveryStart.toISOString(),
      stage: 'RECOVERY_VERIFICATION',
      level: 'INFO',
      message: `Verifying post-workload gateway recovery across ${recoveryProbeCount} clean probes...`,
    });

    for (let i = 1; i <= recoveryProbeCount; i++) {
      if (await isRunCancelled(runId)) return;
      const probeId = `run_rec_${runId}_${i}`;
      recoveryProbeIds.push(probeId);
      const status = await sendRunProbe(
        proxyUrl,
        {
          'x-api-key': recoveryKey.rawKey,
          'x-fortix-run-id': runId,
        },
        probeId,
        params.timeoutMs || 5000
      );
      if (recoveryDurationMs === null && status !== null && status >= 200 && status < 300) {
        recoveryDurationMs = Math.max(1, Date.now() - recoveryStartPerf);
      }
    }
    const recoveryEnd = new Date();

    // =========================================================================
    // PHASE 4: TELEMETRY BARRIER & DETERMINISTIC EVALUATION
    // =========================================================================
    if (await isRunCancelled(runId)) return;

    try {
      await transitionRunStatus(runId, 'VERIFYING');
    } catch (err: any) {
      if (err instanceof InvalidStateTransitionError) return;
      throw err;
    }

    await appendTimeline(runId, {
      timestamp: new Date().toISOString(),
      stage: 'DETERMINISTIC_VERIFICATION',
      level: 'INFO',
      message: 'Flushing telemetry barrier and evaluating synchronized phase evidence...',
    });

    const telemetrySync = await flushTelemetryBarrier({
      timeoutMs: 3000,
      since: startTime,
    });

    const endTime = new Date();
    const queryStart = new Date(startTime.getTime() - 250);
    const queryEnd = new Date(endTime.getTime() + 500);

    const routeMetricsRaw = await db
      .select()
      .from(metricLogs)
      .where(
        and(
          eq(metricLogs.routeId, routeId),
          gte(metricLogs.timestamp, queryStart),
          lte(metricLogs.timestamp, queryEnd)
        )
      );

    const threatEvents = await db
      .select()
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.routeId, routeId),
          gte(securityEvents.timestamp, queryStart),
          lte(securityEvents.timestamp, queryEnd)
        )
      );

    const baselineIdSet = new Set(baselineProbeIds);
    const recoveryIdSet = new Set(recoveryProbeIds);
    const burstIdSet = new Set(burstProbeIds);
    const faultIdSet = new Set(faultProbeIds);
    const injectionIdSet = new Set([...securityProbeIds, ...burstProbeIds, ...faultProbeIds]);
    const allRunProbeIdSet = new Set([
      ...baselineProbeIds,
      ...securityProbeIds,
      ...burstProbeIds,
      ...faultProbeIds,
      ...recoveryProbeIds,
    ]);
    const runMetricsRaw = routeMetricsRaw.filter((m) => m.requestId && allRunProbeIdSet.has(m.requestId));

    const baselineMetrics = computePhaseMetrics(
      'BASELINE',
      runMetricsRaw.filter((m) => m.requestId && baselineIdSet.has(m.requestId)),
      {
        windowStart: baselineStart,
        windowEnd: baselineEnd,
        requestsSent: baselineProbeIds.length,
      }
    );

    const injectionMetrics = computePhaseMetrics(
      'INJECTION',
      runMetricsRaw.filter((m) => m.requestId && injectionIdSet.has(m.requestId)),
      {
        windowStart: injectionStart,
        windowEnd: injectionEnd,
        requestsSent: injectionIdSet.size,
      }
    );

    const recoveryMetrics = computePhaseMetrics(
      'RECOVERY',
      runMetricsRaw.filter((m) => m.requestId && recoveryIdSet.has(m.requestId)),
      {
        windowStart: recoveryStart,
        windowEnd: recoveryEnd,
        requestsSent: recoveryProbeIds.length,
      }
    );

    const burstMetrics =
      burstStart && burstEnd
        ? computePhaseMetrics(
            'INJECTION',
            runMetricsRaw.filter((m) => m.requestId && burstIdSet.has(m.requestId)),
            {
              windowStart: burstStart,
              windowEnd: burstEnd,
              requestsSent: burstRequestsSent,
            }
          )
        : null;

    const faultMetrics =
      faultStart && faultEnd
        ? computePhaseMetrics(
            'INJECTION',
            runMetricsRaw.filter((m) => m.requestId && faultIdSet.has(m.requestId)),
            {
              windowStart: faultStart,
              windowEnd: faultEnd,
              requestsSent: faultProbesSent,
            }
          )
        : null;

    const allDeduplicatedMetrics = computePhaseMetrics('INJECTION', runMetricsRaw, {
      windowStart: startTime,
      windowEnd: endTime,
      minPercentileSamples: MIN_PERCENTILE_SAMPLES,
    });

    // Compute latency percentiles strictly over non-fault operational probes when sample size >= 5
    const nonFaultOperationalMetrics = computePhaseMetrics(
      'INJECTION',
      runMetricsRaw.filter((m) => !m.requestId || !faultIdSet.has(m.requestId)),
      {
        windowStart: startTime,
        windowEnd: endTime,
        minPercentileSamples: MIN_PERCENTILE_SAMPLES,
      }
    );

    const deterministicChecks: DeterministicCheck[] = [];
    const policyViolations: string[] = [];

    // Check 0: Telemetry Synchronization Barrier
    deterministicChecks.push({
      name: 'Telemetry Stream Drain & Persistence Barrier',
      category: 'TELEMETRY',
      status: telemetrySync.synchronized ? 'PASS' : 'INCONCLUSIVE',
      passed: telemetrySync.synchronized,
      observed: telemetrySync.synchronized
        ? `synchronized (${telemetrySync.durationMs}ms)`
        : telemetrySync.error || 'unsynchronized',
      threshold: 'synchronized=true, 0 unpersisted failures',
      evidenceRef: `telemetry_barrier:synchronized=${telemetrySync.synchronized},failures=${telemetrySync.unpersistedFailures}`,
    });

    if (telemetrySync.synchronized) {
      // Check 1: Baseline Readiness
      const baselineCoverageOk = baselineMetrics.observedCount >= Math.ceil(baselineProbeIds.length * 0.8);
      let baselineStatus: VerificationVerdict = 'INCONCLUSIVE';
      if (baselineMetrics.observedCount >= MIN_BASELINE_SAMPLES && baselineCoverageOk) {
        baselineStatus =
          baselineMetrics.serverError5xx === 0 && baselineMetrics.accepted2xx === baselineMetrics.observedCount
            ? 'PASS'
            : 'INCONCLUSIVE';
      }
      deterministicChecks.push({
        name: 'Pre-Injection Baseline Health',
        category: 'BASELINE',
        status: baselineStatus,
        passed: baselineStatus === 'PASS',
        observed: `${baselineMetrics.accepted2xx}/${baselineMetrics.observedCount} 2xx (${
          baselineMetrics.avgLatencyMs ?? 'N/A'
        }ms avg)`,
        threshold: `>= ${MIN_BASELINE_SAMPLES} clean 2xx samples, 0 5xx`,
        evidenceRef: `phases.baseline:2xx=${baselineMetrics.accepted2xx},5xx=${baselineMetrics.serverError5xx}`,
      });

      // Check 2: Security Audit Checks (only when security probes were executed)
      if (profile === 'security-audit' || profile === 'full-verification') {
        const wafProbes = securityProbeOutcomes.filter((p) => p.kind === 'waf');
        const authProbes = securityProbeOutcomes.filter((p) => p.kind === 'auth');

        const wafProbeIdSet = new Set(wafProbes.map((p) => p.id));
        const blockedWafEvents = threatEvents.filter((e) => {
          const action = String((e.payload as any)?.action || '').toLowerCase();
          return e.requestId && wafProbeIdSet.has(e.requestId) && action.startsWith('blocked');
        });

        let wafStatus: VerificationVerdict = 'INCONCLUSIVE';
        if (wafProbes.length === 0 || wafProbes.some((p) => p.actualStatus === null)) {
          wafStatus = 'INCONCLUSIVE';
        } else {
          const allBlocked403 = wafProbes.every((p) => p.actualStatus === 403);
          const eventsRecorded = blockedWafEvents.length >= wafProbes.length;
          wafStatus = allBlocked403 && eventsRecorded ? 'PASS' : 'FAIL';
          if (wafStatus === 'FAIL') {
            policyViolations.push('WAF failed to block one or more SQLi/XSS/Path-Traversal probes with HTTP 403');
          }
        }

        const blockedProbeCount = wafProbes.filter((p) => p.actualStatus === 403).length;
        deterministicChecks.push({
          name: 'WAF & Injection Mitigation',
          category: 'SECURITY',
          status: wafStatus,
          passed: wafStatus === 'PASS',
          observed: `${blockedProbeCount}/${wafProbes.length} HTTP 403, ${blockedWafEvents.length} blocked events`,
          threshold: `${wafProbes.length}/${wafProbes.length} HTTP 403 & logged`,
          evidenceRef: `security_events:blocked_waf=${blockedWafEvents.length}`,
        });

        const authProbe = authProbes[0];
        const invalidKeyEvents = threatEvents.filter((e) => e.threatType === 'INVALID_API_KEY');
        const authStatus: VerificationVerdict =
          !authProbe || authProbe.actualStatus === null
            ? 'INCONCLUSIVE'
            : authProbe.actualStatus === 401 && invalidKeyEvents.length > 0
            ? 'PASS'
            : 'FAIL';

        if (authStatus === 'FAIL') {
          policyViolations.push('Gateway failed to reject invalid API key probe with HTTP 401');
        }

        deterministicChecks.push({
          name: 'API Key Authentication Enforcement',
          category: 'SECURITY',
          status: authStatus,
          passed: authStatus === 'PASS',
          observed: `HTTP ${authProbe?.actualStatus ?? 'ERR'} (${invalidKeyEvents.length} INVALID_API_KEY events)`,
          threshold: 'HTTP 401 & INVALID_API_KEY event',
          evidenceRef: `security_events:invalid_key=${invalidKeyEvents.length}`,
        });
      }

      // Check 3: Burst Rate-Limiting & Latency SLA (when stress burst was executed)
      if (profile === 'resilience-stress' || profile === 'full-verification') {
        if (!burstMetrics || burstMetrics.observedCount < Math.ceil(burstRequestsSent * 0.8)) {
          deterministicChecks.push({
            name: 'Rate Limit Token Bucket Enforcement',
            category: 'RESILIENCE',
            status: 'INCONCLUSIVE',
            passed: false,
            observed: `${burstMetrics?.observedCount ?? 0}/${burstRequestsSent} telemetry samples`,
            threshold: '>= 80% burst telemetry coverage',
            evidenceRef: `phases.burst:observed=${burstMetrics?.observedCount ?? 0},sent=${burstRequestsSent}`,
          });
        } else {
          const rlEval = evaluateRateLimitRule({
            injection: burstMetrics,
            rateLimitRpm: routePolicy?.rateLimitRpm,
          });

          if (rlEval.verdict === 'FAIL') {
            policyViolations.push(`Rate-limit enforcement failed (${rlEval.reasonCode})`);
          }

          deterministicChecks.push({
            name: 'Rate Limit Token Bucket Enforcement',
            category: 'RESILIENCE',
            status: rlEval.verdict,
            passed: rlEval.verdict === 'PASS',
            observed: `${burstMetrics.accepted2xx} accepted (2xx), ${burstMetrics.rateLimited429} rejected (429)`,
            threshold:
              routePolicy?.rateLimitRpm && routePolicy.rateLimitRpm > 0
                ? `RPM=${routePolicy.rateLimitRpm} (max ${rlEval.expected.maxAllowedAccepted ?? routePolicy.rateLimitRpm} accepted)`
                : 'Explicit rateLimitRpm > 0 required',
            evidenceRef: `phases.burst:2xx=${burstMetrics.accepted2xx},429=${burstMetrics.rateLimited429}`,
            reason: rlEval.reasonCode,
          });
        }

        // P95 Latency SLA evaluated strictly when >= 5 samples exist
        const p95 = burstMetrics?.percentiles?.p95 ?? null;
        const slaStatus: VerificationVerdict =
          p95 === null
            ? 'INCONCLUSIVE'
            : p95 <= 3000 && (burstMetrics?.serverError5xx ?? 0) === 0
            ? 'PASS'
            : 'FAIL';

        if (slaStatus === 'FAIL') {
          policyViolations.push('P95 Latency SLA (< 3000ms) or 0-5xx stability breached under stress burst');
        }

        deterministicChecks.push({
          name: 'P95 Latency SLA (< 3000ms)',
          category: 'SLA',
          status: slaStatus,
          passed: slaStatus === 'PASS',
          observed: p95 !== null ? `${p95}ms` : 'insufficient samples (< 5)',
          threshold: '<= 3000ms & 0 5xx',
          evidenceRef: `phases.burst:count=${burstMetrics?.observedCount ?? 0},p95=${p95 ?? 'null'}`,
        });
      }

      // Check 4: Fault Containment (when failover-recovery was executed)
      if (profile === 'failover-recovery' || profile === 'full-verification') {
        const faultCoverageOk =
          faultMetrics !== null &&
          faultMetrics.observedCount >= 3 &&
          faultMetrics.observedCount >= Math.ceil(faultProbesSent * 0.8);
        const faultStatus: VerificationVerdict = !faultCoverageOk
          ? 'INCONCLUSIVE'
          : faultMetrics!.serviceUnavailable503 === faultMetrics!.observedCount &&
            faultMetrics!.serviceUnavailable503 > 0
          ? 'PASS'
          : 'FAIL';

        if (faultStatus === 'FAIL') {
          policyViolations.push('Controlled 503 fault injection containment failed');
        }

        deterministicChecks.push({
          name: 'Controlled Upstream Fault Containment (503)',
          category: 'RESILIENCE',
          status: faultStatus,
          passed: faultStatus === 'PASS',
          observed: `${faultMetrics?.serviceUnavailable503 ?? 0}/${faultMetrics?.observedCount ?? 0} HTTP 503`,
          threshold: '100% controlled HTTP 503 during fault window',
          evidenceRef: `phases.fault:503=${faultMetrics?.serviceUnavailable503 ?? 0},total=${
            faultMetrics?.observedCount ?? 0
          }`,
        });
      }

      // Check 5: Post-Workload / Post-Fault Recovery
      const recCoverageOk =
        recoveryMetrics.observedCount >= MIN_RECOVERY_SAMPLES &&
        recoveryMetrics.observedCount >= Math.ceil(recoveryProbeIds.length * 0.8);
      const recStatus: VerificationVerdict = !recCoverageOk
        ? 'INCONCLUSIVE'
        : recoveryMetrics.serverError5xx === 0 && recoveryMetrics.accepted2xx === recoveryMetrics.observedCount
        ? 'PASS'
        : 'FAIL';

      if (recStatus === 'FAIL') {
        policyViolations.push('Gateway failed post-workload recovery verification');
      }

      deterministicChecks.push({
        name: 'Post-Fault Gateway Recovery',
        category: 'RECOVERY',
        status: recStatus,
        passed: recStatus === 'PASS',
        observed: `${recoveryMetrics.accepted2xx}/${recoveryMetrics.observedCount} 2xx${
          recoveryDurationMs !== null ? ` (recovered in ${recoveryDurationMs}ms)` : ''
        }`,
        threshold: `>= ${MIN_RECOVERY_SAMPLES} clean 2xx samples, 0 5xx`,
        evidenceRef: `phases.recovery:2xx=${recoveryMetrics.accepted2xx},5xx=${
          recoveryMetrics.serverError5xx
        },recoveryDurationMs=${recoveryDurationMs ?? 'null'}`,
      });
    }

    const overallVerdict: VerificationVerdict = !telemetrySync.synchronized
      ? 'INCONCLUSIVE'
      : aggregateVerdicts(deterministicChecks.map((c) => c.status));

    // Calculate objective score grounded strictly in check outcomes (never 100 on FAIL or INCONCLUSIVE)
    const totalChecks = deterministicChecks.length;
    const passCount = deterministicChecks.filter((c) => c.status === 'PASS').length;
    const failCount = deterministicChecks.filter((c) => c.status === 'FAIL').length;
    let score = totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 0;
    if (overallVerdict === 'FAIL') {
      score = Math.min(score, Math.max(0, 65 - failCount * 10));
    } else if (overallVerdict === 'INCONCLUSIVE') {
      score = Math.min(score, 69);
    }

    const totalRequests = allDeduplicatedMetrics.observedCount;
    const passedRequests = allDeduplicatedMetrics.accepted2xx;
    const blockedRequests = allDeduplicatedMetrics.rateLimited429 + allDeduplicatedMetrics.forbidden403;
    const errorRequests = allDeduplicatedMetrics.serverError5xx;
    const latencyPercentiles = nonFaultOperationalMetrics.percentiles;
    const errorRate = nonFaultOperationalMetrics.errorRatePercent;

    const deterministicVerdict: DeterministicVerdict = {
      verdict: overallVerdict,
      passed: overallVerdict === 'PASS',
      score,
      checks: deterministicChecks,
      latencyPercentiles,
      errorRate,
      recoveryDurationMs,
      telemetrySync,
      phases: {
        baseline: baselineMetrics,
        injection: injectionMetrics,
        recovery: recoveryMetrics,
      },
      totalDurationMs: endTime.getTime() - startTime.getTime(),
    };

    // Stage 4: AI-assisted analysis (Evidence-based, read-only)
    if (await isRunCancelled(runId)) return;

    await appendTimeline(runId, {
      timestamp: new Date().toISOString(),
      stage: 'AI_ANALYSIS',
      level: 'INFO',
      message: 'Requesting read-only evidence analysis...',
    });

    const evidenceContext: RunEvidenceContext = {
      runId,
      profile,
      targetUrl: route.targetUrl,
      totalRequests,
      passedRequests,
      blockedRequests,
      errorRequests,
      latencyPercentiles,
      threatEventsCount: threatEvents.length,
      observedThreats: threatEvents.map((t) => t.threatType),
      deterministicScore: score,
      deterministicPassed: deterministicVerdict.passed,
      deterministicVerdict: overallVerdict,
      recoveryStatus:
        recoveryMetrics.observedCount >= MIN_RECOVERY_SAMPLES && recoveryMetrics.serverError5xx === 0
          ? 'CLEANED_AND_RECOVERED'
          : 'RECOVERY_UNVERIFIED_OR_DEGRADED',
      policyViolations,
    };

    const aiAnalysis = await analyzeRunEvidence(evidenceContext);

    await appendTimeline(runId, {
      timestamp: new Date().toISOString(),
      stage: 'AI_ANALYSIS',
      level: aiAnalysis.available ? 'SUCCESS' : 'INFO',
      message: aiAnalysis.available
        ? 'AI analysis completed: Executive summary and recommendations formulated.'
        : `AI analysis unavailable (${aiAnalysis.reason || 'unconfigured'}). Deterministic evaluation preserved.`,
    });

    // Stage 5: Generate and Persist Evidence Artifact Report
    const pctSummary = latencyPercentiles
      ? `P50=${latencyPercentiles.p50}ms, P90=${latencyPercentiles.p90}ms, P95=${latencyPercentiles.p95}ms, P99=${latencyPercentiles.p99}ms`
      : 'Insufficient sample volume (< 5) for percentile calculation';

    const reportText = `
FortiX Autonomous Run Report: ${runId}
Profile: ${profile}
Target URL: ${route.targetUrl}
Duration: ${deterministicVerdict.totalDurationMs}ms
Authoritative Verdict: ${overallVerdict} (Score: ${deterministicVerdict.score}/100)

Synchronized Telemetry Measurements:
- Telemetry Barrier Synchronized: ${telemetrySync.synchronized} (${telemetrySync.durationMs}ms)
- Total Deduplicated Requests: ${totalRequests}
- Baseline Phase: ${baselineMetrics.accepted2xx}/${baselineMetrics.observedCount} 2xx
- Injection Phase: ${injectionMetrics.observedCount} observed (${injectionMetrics.accepted2xx} 2xx, ${injectionMetrics.rateLimited429} 429, ${injectionMetrics.forbidden403} 403, ${injectionMetrics.serverError5xx} 5xx)
- Recovery Phase: ${recoveryMetrics.accepted2xx}/${recoveryMetrics.observedCount} 2xx (recoveryDurationMs=${recoveryDurationMs ?? 'N/A'})
- Operational Latency Percentiles: ${pctSummary}
- Security Threat Events Recorded: ${threatEvents.length}

Deterministic Checks:
${deterministicChecks.map((c) => `- [${c.status}] ${c.name}: observed=${c.observed} | threshold=${c.threshold}`).join('\n')}

AI Executive Summary:
${aiAnalysis.executiveSummary || 'AI analysis unavailable; deterministic telemetry remains fully authoritative.'}

AI Technical Summary:
${aiAnalysis.technicalSummary || 'N/A'}
`;

    let artifactMeta = null;
    try {
      const pdfBuffer = await buildPdfBuffer(
        `FortiX Autonomous Execution Evidence: ${runId}`,
        {
          'Run ID': runId,
          'Project ID': projectId,
          'Route': route.pathPattern,
          'Profile': profile,
          'Deterministic Score': `${score}/100`,
          'Verdict': overallVerdict,
        },
        reportText
      );

      artifactMeta = await artifactStorage.put(pdfBuffer, {
        verificationId: runId,
        projectId,
        filename: `FortiX-AutonomousRun-${runId}.pdf`,
        contentType: 'application/pdf',
        customMetadata: { runId, profile, deterministicScore: String(score), verdict: overallVerdict },
      });
    } catch (artifactErr) {
      console.warn(`Artifact PDF persistence skipped for ${runId}:`, artifactErr);
    }

    const evidenceSummary = {
      verdict: overallVerdict,
      totalRequests,
      passedRequests,
      blockedRequests,
      errorRequests,
      securityEventsCount: threatEvents.length,
      recoveryDurationMs,
      artifactId: artifactMeta?.artifactId,
      sha256: artifactMeta?.sha256,
      storageProvider: artifactMeta?.storageProvider,
    };

    if (await isRunCancelled(runId)) return;

    const finalStatus: WorkflowStatus = overallVerdict === 'PASS' ? 'COMPLETED' : 'RECOVERY_REQUIRED';
    await transitionRunStatus(runId, finalStatus, {
      deterministicVerdict,
      aiAnalysis,
      evidenceSummary,
      cleanupStatus: 'CLEANED',
      completedAt: new Date(),
    });

    await appendTimeline(runId, {
      timestamp: new Date().toISOString(),
      stage: finalStatus,
      level: overallVerdict === 'PASS' ? 'SUCCESS' : 'WARN',
      message: `Workflow finished with verdict ${overallVerdict} (state: ${finalStatus}). Deterministic score: ${score}/100.`,
      details: { finalStatus, verdict: overallVerdict, score, totalRequests },
    });
  } catch (executionError: any) {
    console.error(`Autonomous run ${runId} execution failure:`, executionError);
    if (!(await isRunCancelled(runId))) {
      try {
        await transitionRunStatus(runId, 'FAILED', {
          errorMessage: executionError?.message || String(executionError),
          completedAt: new Date(),
          cleanupStatus: 'CLEANED',
        });
      } catch {}

      await appendTimeline(runId, {
        timestamp: new Date().toISOString(),
        stage: 'FAILED',
        level: 'ERROR',
        message: `Run aborted due to error: ${executionError?.message || executionError}`,
      });
    }
  } finally {
    // Guaranteed Cleanup of Faults and Ephemeral Keys across all phases
    for (const k of allocatedKeys) {
      try {
        await db.delete(apiKeys).where(eq(apiKeys.id, k.keyId));
      } catch {}
      invalidateApiKeyCache(k.keyId, projectId);
    }

    for (const expId of createdExperimentIds) {
      try {
        await db
          .update(experiments)
          .set({ status: 'COMPLETED', completedAt: new Date() })
          .where(eq(experiments.id, expId));
      } catch {}
    }
    invalidateExpCache(routeId);
  }
}
