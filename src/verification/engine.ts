import { db } from '../db/index.js';
import { verifications, metricLogs, securityPolicies, experiments } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { flushTelemetryBarrier, TelemetrySyncResult } from '../lib/telemetry.js';
import {
  computePhaseMetrics,
  evaluateExperimentVerification,
  MIN_INJECTION_SAMPLES,
  MIN_BASELINE_SAMPLES,
  MIN_RECOVERY_SAMPLES,
  MIN_TELEMETRY_COVERAGE_RATIO,
} from './domain.js';

export interface PhaseExecutionWindow {
  startTime: Date;
  endTime: Date;
  requestsSent?: number;
  requestIds?: string[];
}

export interface VerifyPolicyOptions {
  phases?: {
    baseline?: PhaseExecutionWindow;
    injection?: PhaseExecutionWindow;
    recovery?: PhaseExecutionWindow;
  };
  recoveryDurationMs?: number | null;
  requireBaseline?: boolean;
  requireRecovery?: boolean;
  syncTimeoutMs?: number;
  minInjectionSamples?: number;
  minBaselineSamples?: number;
  minRecoverySamples?: number;
  minCoverageRatio?: number;
  forceReverify?: boolean;
}

const activeVerificationLocks = new Map<string, Promise<any>>();

function filterRowsForPhase(
  allRows: Array<typeof metricLogs.$inferSelect>,
  window: PhaseExecutionWindow,
  excludedRequestIds?: Set<string>
): Array<typeof metricLogs.$inferSelect> {
  const reqIdSet = window.requestIds && window.requestIds.length > 0 ? new Set(window.requestIds) : null;
  const startMs = window.startTime.getTime();
  const endMs = window.endTime.getTime();

  return allRows.filter((row) => {
    if (row.requestId && excludedRequestIds?.has(row.requestId)) {
      return false;
    }
    if (reqIdSet && row.requestId && reqIdSet.has(row.requestId)) {
      return true;
    }
    if (reqIdSet && window.requestIds!.length > 0 && excludedRequestIds === undefined) {
      // Strict requestId match for explicitly tagged BASELINE / RECOVERY probe sets
      return false;
    }
    const ts = new Date(row.timestamp).getTime();
    return ts >= startMs && ts <= endMs;
  });
}

export async function verifyPolicy(
  experimentId: string,
  policyId: string | null | undefined,
  startTime: Date,
  endTime: Date,
  options?: VerifyPolicyOptions
) {
  const existingLock = activeVerificationLocks.get(experimentId);
  if (existingLock) {
    return existingLock;
  }

  const executionPromise = (async () => {
    if (!options?.forceReverify) {
      const [existing] = await db
        .select()
        .from(verifications)
        .where(eq(verifications.experimentId, experimentId))
        .orderBy(desc(verifications.createdAt))
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    const overallStart = options?.phases?.baseline?.startTime
      ? new Date(Math.min(startTime.getTime(), options.phases.baseline.startTime.getTime()))
      : startTime;
    const overallEnd = options?.phases?.recovery?.endTime
      ? new Date(Math.max(endTime.getTime(), options.phases.recovery.endTime.getTime()))
      : endTime;

    // 1. Synchronize telemetry pipeline before reading metricLogs
    const telemetrySync: TelemetrySyncResult = await flushTelemetryBarrier({
      timeoutMs: options?.syncTimeoutMs ?? 3000,
      since: overallStart,
    });

    // Double-check idempotency after async barrier in case another caller persisted beforehand
    if (!options?.forceReverify) {
      const [existingAfterSync] = await db
        .select()
        .from(verifications)
        .where(eq(verifications.experimentId, experimentId))
        .orderBy(desc(verifications.createdAt))
        .limit(1);
      if (existingAfterSync) {
        return existingAfterSync;
      }
    }

    const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId)).limit(1);

    let policy: typeof securityPolicies.$inferSelect | undefined;
    if (policyId) {
      const [foundPolicy] = await db
        .select()
        .from(securityPolicies)
        .where(eq(securityPolicies.id, policyId))
        .limit(1);
      policy = foundPolicy;
    } else if (exp?.routeId) {
      const [foundRoutePolicy] = await db
        .select()
        .from(securityPolicies)
        .where(eq(securityPolicies.routeId, exp.routeId))
        .limit(1);
      policy = foundRoutePolicy;
    }

    // 2. Fetch persisted metrics with small clock-skew padding around overall window
    const queryStart = new Date(overallStart.getTime() - 250);
    const queryEnd = new Date(overallEnd.getTime() + 500);
    const allExperimentMetrics = await db
      .select()
      .from(metricLogs)
      .where(
        and(
          eq(metricLogs.experimentId, experimentId),
          gte(metricLogs.timestamp, queryStart),
          lte(metricLogs.timestamp, queryEnd)
        )
      );

    // 3. Partition metrics cleanly across BASELINE -> INJECTION -> RECOVERY
    const baselineWindow = options?.phases?.baseline;
    const recoveryWindow = options?.phases?.recovery;
    const injectionWindow: PhaseExecutionWindow = options?.phases?.injection || {
      startTime,
      endTime,
    };

    const nonInjectionReqIds = new Set<string>([
      ...(baselineWindow?.requestIds || []),
      ...(recoveryWindow?.requestIds || []),
    ]);

    const baselineRows = baselineWindow ? filterRowsForPhase(allExperimentMetrics, baselineWindow) : null;
    const recoveryRows = recoveryWindow ? filterRowsForPhase(allExperimentMetrics, recoveryWindow) : null;
    const injectionRows = filterRowsForPhase(allExperimentMetrics, injectionWindow, nonInjectionReqIds);

    const baselineMetrics =
      baselineWindow && baselineRows
        ? computePhaseMetrics('BASELINE', baselineRows, {
            windowStart: baselineWindow.startTime,
            windowEnd: baselineWindow.endTime,
            requestsSent: baselineWindow.requestsSent,
          })
        : null;

    const injectionMetrics = computePhaseMetrics('INJECTION', injectionRows, {
      windowStart: injectionWindow.startTime,
      windowEnd: injectionWindow.endTime,
      requestsSent: injectionWindow.requestsSent,
    });

    const recoveryMetrics =
      recoveryWindow && recoveryRows
        ? computePhaseMetrics('RECOVERY', recoveryRows, {
            windowStart: recoveryWindow.startTime,
            windowEnd: recoveryWindow.endTime,
            requestsSent: recoveryWindow.requestsSent,
          })
        : null;

    // 4. Evaluate deterministic verification rules
    const evaluation = evaluateExperimentVerification({
      experiment: exp
        ? {
            id: exp.id,
            type: exp.type,
            status: exp.status,
            config: (exp.config as Record<string, any>) || {},
          }
        : null,
      policy: policy
        ? {
            id: policy.id,
            rateLimitRpm: policy.rateLimitRpm,
            enableWaf: policy.enableWaf,
            enableSsrf: policy.enableSsrf,
          }
        : null,
      telemetrySync,
      baseline: baselineMetrics,
      injection: injectionMetrics,
      recovery: recoveryMetrics,
      recoveryDurationMs: options?.recoveryDurationMs ?? null,
      requireBaseline: options?.requireBaseline,
      requireRecovery: options?.requireRecovery,
      minInjectionSamples: options?.minInjectionSamples ?? MIN_INJECTION_SAMPLES,
      minBaselineSamples: options?.minBaselineSamples ?? MIN_BASELINE_SAMPLES,
      minRecoverySamples: options?.minRecoverySamples ?? MIN_RECOVERY_SAMPLES,
      minCoverageRatio: options?.minCoverageRatio ?? MIN_TELEMETRY_COVERAGE_RATIO,
    });

    if (!exp) {
      return null;
    }

    const [verification] = await db
      .insert(verifications)
      .values({
        id: uuidv4(),
        experimentId,
        expected: evaluation.expected,
        observed: evaluation.observed,
        verdict: evaluation.verdict,
      })
      .returning();

    return verification;
  })().finally(() => {
    activeVerificationLocks.delete(experimentId);
  });

  activeVerificationLocks.set(experimentId, executionPromise);
  return executionPromise;
}
