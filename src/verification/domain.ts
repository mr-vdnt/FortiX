import type { TelemetrySyncResult } from '../lib/telemetry.js';

export type VerificationVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type VerificationPhaseName = 'BASELINE' | 'INJECTION' | 'RECOVERY';

export const MIN_INJECTION_SAMPLES = 5;
export const MIN_PERCENTILE_SAMPLES = 5;
export const MIN_BASELINE_SAMPLES = 3;
export const MIN_RECOVERY_SAMPLES = 3;
export const MIN_TELEMETRY_COVERAGE_RATIO = 0.8;

export function normalizeVerdict(raw?: string | null): VerificationVerdict {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'PASS' || upper === 'PASSED') return 'PASS';
  if (upper === 'FAIL' || upper === 'FAILED') return 'FAIL';
  return 'INCONCLUSIVE';
}

export interface RawMetricSample {
  id?: string | null;
  requestId?: string | null;
  latencyMs: number;
  statusCode: number;
  timestamp?: Date | string | null;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface PhaseWindowMetrics {
  phase: VerificationPhaseName;
  windowStart: string | null;
  windowEnd: string | null;
  durationMs: number;
  requestsSent: number | null;
  observedCount: number;
  duplicateDroppedCount: number;
  malformedDroppedCount: number;
  telemetryCoverageRatio: number | null;
  accepted2xx: number;
  rateLimited429: number;
  forbidden403: number;
  unauthorized401: number;
  clientError4xx: number;
  serverError5xx: number;
  serviceUnavailable503: number;
  gatewayTimeout504: number;
  avgLatencyMs: number | null;
  errorRatePercent: number | null;
  availabilityPercent: number | null;
  percentiles: LatencyPercentiles | null;
}

export interface VerificationRuleCheck {
  id: string;
  name: string;
  category: 'TELEMETRY' | 'BASELINE' | 'SECURITY' | 'RESILIENCE' | 'SLA' | 'RECOVERY';
  status: VerificationVerdict;
  passed: boolean;
  observed: string | number;
  threshold: string | number;
  reason: string;
  evidenceRef: string;
}

export interface DeduplicationResult {
  validRows: RawMetricSample[];
  duplicateDroppedCount: number;
  malformedDroppedCount: number;
}

export function deduplicateMetrics(rows: RawMetricSample[]): DeduplicationResult {
  const seenIds = new Set<string>();
  const seenRequestIds = new Set<string>();
  const validRows: RawMetricSample[] = [];
  let duplicateDroppedCount = 0;
  let malformedDroppedCount = 0;

  for (const row of rows) {
    if (
      !row ||
      typeof row.latencyMs !== 'number' ||
      !Number.isFinite(row.latencyMs) ||
      row.latencyMs < 0 ||
      typeof row.statusCode !== 'number' ||
      !Number.isInteger(row.statusCode) ||
      row.statusCode < 100 ||
      row.statusCode > 599
    ) {
      malformedDroppedCount++;
      continue;
    }

    const rowId = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
    const reqId = typeof row.requestId === 'string' && row.requestId.trim() ? row.requestId.trim() : null;

    if ((rowId && seenIds.has(rowId)) || (reqId && seenRequestIds.has(reqId))) {
      duplicateDroppedCount++;
      continue;
    }

    if (rowId) seenIds.add(rowId);
    if (reqId) seenRequestIds.add(reqId);
    validRows.push(row);
  }

  return {
    validRows,
    duplicateDroppedCount,
    malformedDroppedCount,
  };
}

export function computeExactPercentile(sortedLatencies: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedLatencies.length) - 1;
  const clamped = Math.max(0, Math.min(sortedLatencies.length - 1, rank));
  return Math.round(sortedLatencies[clamped]);
}

export function computePhaseMetrics(
  phase: VerificationPhaseName,
  rows: RawMetricSample[],
  meta?: {
    windowStart?: Date | null;
    windowEnd?: Date | null;
    requestsSent?: number | null;
    minPercentileSamples?: number;
  }
): PhaseWindowMetrics {
  const { validRows, duplicateDroppedCount, malformedDroppedCount } = deduplicateMetrics(rows);
  const observedCount = validRows.length;
  const minPctSamples = meta?.minPercentileSamples ?? MIN_PERCENTILE_SAMPLES;

  const startMs = meta?.windowStart ? meta.windowStart.getTime() : null;
  const endMs = meta?.windowEnd ? meta.windowEnd.getTime() : null;
  let durationMs = startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : 0;

  if (durationMs === 0 && observedCount >= 2) {
    const timestamps = validRows
      .map((r) => (r.timestamp ? new Date(r.timestamp).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    if (timestamps.length >= 2) {
      durationMs = Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
    }
  }

  const requestsSent =
    typeof meta?.requestsSent === 'number' && Number.isFinite(meta.requestsSent) && meta.requestsSent >= 0
      ? meta.requestsSent
      : null;

  const telemetryCoverageRatio =
    requestsSent !== null && requestsSent > 0
      ? Math.min(1, Number((observedCount / requestsSent).toFixed(4)))
      : null;

  const accepted2xx = validRows.filter((r) => r.statusCode >= 200 && r.statusCode < 300).length;
  const rateLimited429 = validRows.filter((r) => r.statusCode === 429).length;
  const forbidden403 = validRows.filter((r) => r.statusCode === 403).length;
  const unauthorized401 = validRows.filter((r) => r.statusCode === 401).length;
  const clientError4xx = validRows.filter((r) => r.statusCode >= 400 && r.statusCode < 500).length;
  const serverError5xx = validRows.filter((r) => r.statusCode >= 500).length;
  const serviceUnavailable503 = validRows.filter((r) => r.statusCode === 503).length;
  const gatewayTimeout504 = validRows.filter((r) => r.statusCode === 504).length;

  // Never synthesize 0ms latency, 0% error rate, or 100% availability from zero observations
  if (observedCount === 0) {
    return {
      phase,
      windowStart: meta?.windowStart ? meta.windowStart.toISOString() : null,
      windowEnd: meta?.windowEnd ? meta.windowEnd.toISOString() : null,
      durationMs,
      requestsSent,
      observedCount: 0,
      duplicateDroppedCount,
      malformedDroppedCount,
      telemetryCoverageRatio,
      accepted2xx: 0,
      rateLimited429: 0,
      forbidden403: 0,
      unauthorized401: 0,
      clientError4xx: 0,
      serverError5xx: 0,
      serviceUnavailable503: 0,
      gatewayTimeout504: 0,
      avgLatencyMs: null,
      errorRatePercent: null,
      availabilityPercent: null,
      percentiles: null,
    };
  }

  const totalLatency = validRows.reduce((acc, r) => acc + r.latencyMs, 0);
  const avgLatencyMs = Math.round(totalLatency / observedCount);
  const errorRatePercent = Math.round((serverError5xx / observedCount) * 1000) / 10;
  const availabilityPercent = Math.round(((observedCount - serverError5xx) / observedCount) * 1000) / 10;

  let percentiles: LatencyPercentiles | null = null;
  if (observedCount >= minPctSamples) {
    const sorted = validRows.map((r) => r.latencyMs).sort((a, b) => a - b);
    percentiles = {
      p50: computeExactPercentile(sorted, 50),
      p90: computeExactPercentile(sorted, 90),
      p95: computeExactPercentile(sorted, 95),
      p99: computeExactPercentile(sorted, 99),
    };
  }

  return {
    phase,
    windowStart: meta?.windowStart ? meta.windowStart.toISOString() : null,
    windowEnd: meta?.windowEnd ? meta.windowEnd.toISOString() : null,
    durationMs,
    requestsSent,
    observedCount,
    duplicateDroppedCount,
    malformedDroppedCount,
    telemetryCoverageRatio,
    accepted2xx,
    rateLimited429,
    forbidden403,
    unauthorized401,
    clientError4xx,
    serverError5xx,
    serviceUnavailable503,
    gatewayTimeout504,
    avgLatencyMs,
    errorRatePercent,
    availabilityPercent,
    percentiles,
  };
}

export function aggregateVerdicts(verdicts: VerificationVerdict[]): VerificationVerdict {
  if (verdicts.length === 0) return 'INCONCLUSIVE';
  if (verdicts.some((v) => v === 'FAIL')) return 'FAIL';
  if (verdicts.some((v) => v === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

export function evaluateRateLimitRule(params: {
  injection: PhaseWindowMetrics;
  rateLimitRpm: number | null | undefined;
}): {
  verdict: VerificationVerdict;
  reasonCode: string;
  expected: Record<string, any>;
  checks: VerificationRuleCheck[];
} {
  const { injection, rateLimitRpm } = params;

  if (typeof rateLimitRpm !== 'number' || !Number.isFinite(rateLimitRpm) || rateLimitRpm <= 0) {
    return {
      verdict: 'INCONCLUSIVE',
      reasonCode: 'INVALID_RATE_LIMIT_POLICY',
      expected: {
        policyRequired: 'rateLimitRpm > 0',
      },
      checks: [
        {
          id: 'RATE_LIMIT_POLICY_CONFIG',
          name: 'Rate-Limit Policy Configuration',
          category: 'SECURITY',
          status: 'INCONCLUSIVE',
          passed: false,
          observed: String(rateLimitRpm ?? 'missing'),
          threshold: 'rateLimitRpm > 0',
          reason: 'Route policy lacks a positive rateLimitRpm configuration.',
          evidenceRef: 'security_policies:rate_limit_rpm',
        },
      ],
    };
  }

  const windowMs = Math.max(1, injection.durationMs);
  const refillTokens = Math.floor((windowMs / 60000) * rateLimitRpm);
  const effectiveCapacity = rateLimitRpm + refillTokens;
  const maxAllowedAccepted = effectiveCapacity + 1;

  if (injection.observedCount <= maxAllowedAccepted) {
    return {
      verdict: 'INCONCLUSIVE',
      reasonCode: 'INSUFFICIENT_TRAFFIC_TO_TRIGGER_RATE_LIMIT',
      expected: {
        rateLimitRpm,
        windowMs,
        effectiveCapacity,
        minRequiredObservedRequests: maxAllowedAccepted + 1,
      },
      checks: [
        {
          id: 'RATE_LIMIT_TRAFFIC_SUFFICIENCY',
          name: 'Rate-Limit Burst Volume Above Bucket Capacity',
          category: 'SECURITY',
          status: 'INCONCLUSIVE',
          passed: false,
          observed: `${injection.observedCount} observed requests`,
          threshold: `>= ${maxAllowedAccepted + 1} requests (capacity ${effectiveCapacity})`,
          reason: `Observed traffic (${injection.observedCount}) did not exceed token-bucket capacity (${effectiveCapacity}) over ${windowMs}ms, so rate-limit enforcement was never exercised.`,
          evidenceRef: `metric_logs:injection_count=${injection.observedCount},capacity=${effectiveCapacity}`,
        },
      ],
    };
  }

  const expectedMinRejected = Math.max(1, injection.observedCount - maxAllowedAccepted);
  const checks: VerificationRuleCheck[] = [];

  const rejectedPass = injection.rateLimited429 >= expectedMinRejected;
  checks.push({
    id: 'RATE_LIMIT_429_ENFORCEMENT',
    name: 'HTTP 429 Excess Request Rejection',
    category: 'SECURITY',
    status: rejectedPass ? 'PASS' : 'FAIL',
    passed: rejectedPass,
    observed: `${injection.rateLimited429} rejected (429)`,
    threshold: `>= ${expectedMinRejected} rejected (429)`,
    reason: rejectedPass
      ? `Gateway rejected ${injection.rateLimited429} excess requests with HTTP 429.`
      : `Gateway rejected only ${injection.rateLimited429} requests with HTTP 429; expected at least ${expectedMinRejected}.`,
    evidenceRef: `metric_logs:429_count=${injection.rateLimited429},expected_min=${expectedMinRejected}`,
  });

  const acceptedCeilingPass = injection.accepted2xx <= maxAllowedAccepted && injection.accepted2xx > 0;
  checks.push({
    id: 'RATE_LIMIT_CAPACITY_CEILING',
    name: 'Token Bucket Accepted Ceiling',
    category: 'SECURITY',
    status: acceptedCeilingPass ? 'PASS' : 'FAIL',
    passed: acceptedCeilingPass,
    observed: `${injection.accepted2xx} accepted (2xx)`,
    threshold: `1..${maxAllowedAccepted} accepted (2xx)`,
    reason:
      injection.accepted2xx === 0
        ? 'Zero upstream 2xx responses succeeded before rate limiting.'
        : acceptedCeilingPass
        ? `Accepted 2xx traffic (${injection.accepted2xx}) remained within token-bucket ceiling (${maxAllowedAccepted}).`
        : `Accepted 2xx traffic (${injection.accepted2xx}) exceeded token-bucket ceiling (${maxAllowedAccepted}).`,
    evidenceRef: `metric_logs:2xx_count=${injection.accepted2xx},max_allowed=${maxAllowedAccepted}`,
  });

  const stabilityPass = injection.serverError5xx === 0;
  checks.push({
    id: 'RATE_LIMIT_GATEWAY_STABILITY',
    name: 'Zero 5xx Errors Under Rate-Limit Burst',
    category: 'RESILIENCE',
    status: stabilityPass ? 'PASS' : 'FAIL',
    passed: stabilityPass,
    observed: `${injection.serverError5xx} server errors (5xx)`,
    threshold: '0 server errors (5xx)',
    reason: stabilityPass
      ? 'Gateway shed excess load cleanly via 429 without 5xx crashes.'
      : `Gateway produced ${injection.serverError5xx} unexpected 5xx server errors during burst.`,
    evidenceRef: `metric_logs:5xx_count=${injection.serverError5xx}`,
  });

  const verdict = aggregateVerdicts(checks.map((c) => c.status));
  const reasonCode =
    verdict === 'PASS'
      ? 'RATE_LIMIT_ENFORCEMENT_VERIFIED'
      : !stabilityPass
      ? 'SERVER_ERROR_DURING_RATE_LIMIT_BURST'
      : !rejectedPass
      ? 'RATE_LIMIT_UNDER_ENFORCED'
      : 'RATE_LIMIT_CAPACITY_EXCEEDED';

  return {
    verdict,
    reasonCode,
    expected: {
      rateLimitRpm,
      windowMs,
      refillTokens,
      effectiveCapacity,
      maxAllowedAccepted,
      expectedMinRejected,
      allowedServerErrors: 0,
    },
    checks,
  };
}

export interface VerificationEvaluationInput {
  experiment: {
    id: string;
    type: string;
    status: string;
    config?: Record<string, any> | null;
  } | null;
  policy: {
    id: string;
    rateLimitRpm?: number | null;
    enableWaf?: boolean | null;
    enableSsrf?: boolean | null;
  } | null;
  telemetrySync: TelemetrySyncResult;
  baseline?: PhaseWindowMetrics | null;
  injection: PhaseWindowMetrics;
  recovery?: PhaseWindowMetrics | null;
  recoveryDurationMs?: number | null;
  requireBaseline?: boolean;
  requireRecovery?: boolean;
  minInjectionSamples?: number;
  minBaselineSamples?: number;
  minRecoverySamples?: number;
  minCoverageRatio?: number;
}

export interface VerificationEvaluationOutput {
  verdict: VerificationVerdict;
  reasonCode: string;
  summary: string;
  expected: Record<string, any>;
  observed: Record<string, any>;
  checks: VerificationRuleCheck[];
}

export function evaluateExperimentVerification(input: VerificationEvaluationInput): VerificationEvaluationOutput {
  const minInjectionSamples = input.minInjectionSamples ?? MIN_INJECTION_SAMPLES;
  const minBaselineSamples = input.minBaselineSamples ?? MIN_BASELINE_SAMPLES;
  const minRecoverySamples = input.minRecoverySamples ?? MIN_RECOVERY_SAMPLES;
  const minCoverageRatio = input.minCoverageRatio ?? MIN_TELEMETRY_COVERAGE_RATIO;
  const checks: VerificationRuleCheck[] = [];

  const buildOutput = (
    verdict: VerificationVerdict,
    reasonCode: string,
    summary: string,
    expected: Record<string, any>
  ): VerificationEvaluationOutput => {
    const observed = {
      reasonCode,
      summary,
      // Top-level compatibility metrics derived strictly from synchronized injection phase (null when 0 samples)
      total: input.injection.observedCount,
      accepted: input.injection.accepted2xx,
      rejected: input.injection.rateLimited429,
      forbidden: input.injection.forbidden403,
      unauthorized: input.injection.unauthorized401,
      error: input.injection.serverError5xx,
      avgLatencyMs: input.injection.avgLatencyMs,
      errorRatePercent: input.injection.errorRatePercent,
      percentiles: input.injection.percentiles,
      recoveryDurationMs: input.recoveryDurationMs ?? null,
      telemetrySync: input.telemetrySync,
      phases: {
        baseline: input.baseline ?? null,
        injection: input.injection,
        recovery: input.recovery ?? null,
      },
      checks,
    };

    return {
      verdict,
      reasonCode,
      summary,
      expected,
      observed,
      checks,
    };
  };

  // 1. Missing or Cancelled Experiment
  if (!input.experiment) {
    return buildOutput(
      'INCONCLUSIVE',
      'EXPERIMENT_NOT_FOUND',
      'Experiment record was not found for verification.',
      { requiredExperiment: true }
    );
  }

  if (input.experiment.status === 'CANCELLED') {
    checks.push({
      id: 'EXPERIMENT_LIFECYCLE_NOT_CANCELLED',
      name: 'Experiment Completed Without Cancellation',
      category: 'TELEMETRY',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: 'CANCELLED',
      threshold: 'COMPLETED / ANALYZING',
      reason: 'Experiment was cancelled prior to completion; incomplete evidence cannot establish PASS or FAIL.',
      evidenceRef: `experiments:id=${input.experiment.id},status=CANCELLED`,
    });
    return buildOutput(
      'INCONCLUSIVE',
      'EXPERIMENT_CANCELLED',
      'Experiment was cancelled prior to verification completion.',
      { experimentStatus: 'ACTIVE_COMPLETE' }
    );
  }

  // 2. Telemetry Synchronization Barrier Check
  if (!input.telemetrySync.synchronized) {
    const code = input.telemetrySync.timedOut ? 'TELEMETRY_SYNC_TIMEOUT' : 'TELEMETRY_INGESTION_ERROR';
    checks.push({
      id: 'TELEMETRY_SYNC_BARRIER',
      name: 'Telemetry Stream Drain & Persistence Barrier',
      category: 'TELEMETRY',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: input.telemetrySync.error || 'unsynchronized',
      threshold: 'synchronized=true, unpersistedFailures=0',
      reason:
        input.telemetrySync.error ||
        'Telemetry barrier failed to synchronize all observations within bounded timeout.',
      evidenceRef: `telemetry_barrier:timedOut=${input.telemetrySync.timedOut},failures=${input.telemetrySync.unpersistedFailures}`,
    });
    return buildOutput(
      'INCONCLUSIVE',
      code,
      `Telemetry synchronization barrier failed (${code}); refusing to compute verdict on unsynchronized observations.`,
      { telemetrySynchronized: true }
    );
  }

  checks.push({
    id: 'TELEMETRY_SYNC_BARRIER',
    name: 'Telemetry Stream Drain & Persistence Barrier',
    category: 'TELEMETRY',
    status: 'PASS',
    passed: true,
    observed: `synchronized (${input.telemetrySync.durationMs}ms)`,
    threshold: 'synchronized=true',
    reason: 'All in-flight telemetry writes and stream entries flushed before evaluation.',
    evidenceRef: `telemetry_barrier:drained=${input.telemetrySync.streamDrainedCount},inFlight=${input.telemetrySync.inFlightResolved}`,
  });

  // 3. Policy Presence & Experiment Type Validation
  const expType = input.experiment.type;
  const supportedTypes = ['latency', 'timeout', 'error_5xx', 'traffic_burst', 'rate_limit'];
  if (!supportedTypes.includes(expType)) {
    return buildOutput(
      'INCONCLUSIVE',
      'UNSUPPORTED_EXPERIMENT_TYPE',
      `Unsupported experiment type '${expType}'.`,
      { supportedTypes }
    );
  }

  if (!input.policy) {
    checks.push({
      id: 'ROUTE_POLICY_PRESENT',
      name: 'Route Security Policy Attached',
      category: 'SECURITY',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: 'missing',
      threshold: 'Explicit security_policies row required',
      reason: 'No security policy is configured for this route; verification will not assume implicit default thresholds.',
      evidenceRef: 'security_policies:missing',
    });
    return buildOutput(
      'INCONCLUSIVE',
      'MISSING_SECURITY_POLICY',
      'Route has no configured security policy to verify against.',
      { policyRequired: true }
    );
  }

  const rawConfig = (input.experiment.config || {}) as Record<string, any>;
  if (expType === 'latency' && rawConfig.latencyMs !== undefined) {
    const parsedLat = Number(rawConfig.latencyMs);
    if (!Number.isFinite(parsedLat) || parsedLat <= 0) {
      checks.push({
        id: 'EXPERIMENT_CONFIG_VALID',
        name: 'Latency Fault Configuration Validity',
        category: 'RESILIENCE',
        status: 'INCONCLUSIVE',
        passed: false,
        observed: String(rawConfig.latencyMs),
        threshold: 'latencyMs > 0',
        reason: 'Configured latencyMs must be a positive number to verify latency fault behavior.',
        evidenceRef: `experiments:id=${input.experiment.id},latencyMs=${rawConfig.latencyMs}`,
      });
      return buildOutput(
        'INCONCLUSIVE',
        'INVALID_EXPERIMENT_CONFIG',
        'Latency experiment has non-positive or invalid latencyMs configuration.',
        { latencyMs: '> 0' }
      );
    }
  }

  if ((expType === 'traffic_burst' || expType === 'rate_limit') && (!input.policy.rateLimitRpm || input.policy.rateLimitRpm <= 0)) {
    const rl = evaluateRateLimitRule({ injection: input.injection, rateLimitRpm: input.policy.rateLimitRpm });
    checks.push(...rl.checks);
    return buildOutput(rl.verdict, rl.reasonCode, 'Rate-limit policy is missing or non-positive.', rl.expected);
  }

  // 4. Injection Sample Volume & Telemetry Completeness Checks
  if (input.injection.observedCount === 0) {
    checks.push({
      id: 'INJECTION_SAMPLE_VOLUME',
      name: 'Injection Phase Observed Sample Count',
      category: 'TELEMETRY',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: 0,
      threshold: `>= ${minInjectionSamples}`,
      reason: 'Zero observed requests recorded during active experiment window.',
      evidenceRef: `metric_logs:experiment_id=${input.experiment.id},count=0`,
    });
    return buildOutput(
      'INCONCLUSIVE',
      'ZERO_OBSERVED_REQUESTS',
      'Zero telemetry observations were recorded for this experiment.',
      { minObservedRequests: minInjectionSamples }
    );
  }

  if (input.injection.requestsSent !== null && input.injection.requestsSent > 0) {
    const minRequiredByCoverage = Math.ceil(input.injection.requestsSent * minCoverageRatio);
    if (input.injection.observedCount < minRequiredByCoverage) {
      checks.push({
        id: 'TELEMETRY_COMPLETENESS_COVERAGE',
        name: 'Telemetry Observation Completeness Ratio',
        category: 'TELEMETRY',
        status: 'INCONCLUSIVE',
        passed: false,
        observed: `${input.injection.observedCount}/${input.injection.requestsSent} (${Math.round(
          (input.injection.telemetryCoverageRatio ?? 0) * 100
        )}%)`,
        threshold: `>= ${Math.round(minCoverageRatio * 100)}% of sent requests`,
        reason: `Only ${input.injection.observedCount} of ${input.injection.requestsSent} sent probes were persisted in telemetry.`,
        evidenceRef: `metric_logs:observed=${input.injection.observedCount},sent=${input.injection.requestsSent}`,
      });
      return buildOutput(
        'INCONCLUSIVE',
        'PARTIAL_TELEMETRY_LOSS',
        'Partial telemetry loss detected: observed sample count fell below minimum coverage threshold of sent probes.',
        {
          requestsSent: input.injection.requestsSent,
          minCoverageRatio,
          minRequiredObservedRequests: minRequiredByCoverage,
        }
      );
    }
  }

  if (input.injection.observedCount < minInjectionSamples) {
    checks.push({
      id: 'INJECTION_SAMPLE_VOLUME',
      name: 'Injection Phase Minimum Sample Size',
      category: 'TELEMETRY',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: input.injection.observedCount,
      threshold: `>= ${minInjectionSamples}`,
      reason: `Observed sample count (${input.injection.observedCount}) is below minimum threshold (${minInjectionSamples}) for reliable verification.`,
      evidenceRef: `metric_logs:count=${input.injection.observedCount},min=${minInjectionSamples}`,
    });
    return buildOutput(
      'INCONCLUSIVE',
      'INSUFFICIENT_INJECTION_SAMPLES',
      `Insufficient injection sample size (${input.injection.observedCount} < ${minInjectionSamples}).`,
      { minObservedRequests: minInjectionSamples }
    );
  }

  // 5. Baseline Phase Validation (required when requireBaseline=true or when baseline metrics are supplied)
  if (input.requireBaseline && !input.baseline) {
    checks.push({
      id: 'BASELINE_EVIDENCE_PRESENT',
      name: 'Pre-Fault Baseline Observation Window',
      category: 'BASELINE',
      status: 'INCONCLUSIVE',
      passed: false,
      observed: 'missing',
      threshold: `>= ${minBaselineSamples} healthy baseline samples`,
      reason: 'Baseline phase metrics were not recorded prior to fault injection.',
      evidenceRef: 'phases.baseline:missing',
    });
    return buildOutput(
      'INCONCLUSIVE',
      'MISSING_BASELINE_EVIDENCE',
      'Pre-injection baseline observation window is missing.',
      { minBaselineSamples }
    );
  }

  if (input.baseline) {
    const baseSent = input.baseline.requestsSent;
    const baseCoverageOk =
      baseSent === null || baseSent === 0 || input.baseline.observedCount >= Math.ceil(baseSent * minCoverageRatio);

    if (input.baseline.observedCount < minBaselineSamples || !baseCoverageOk) {
      checks.push({
        id: 'BASELINE_SAMPLE_SUFFICIENCY',
        name: 'Pre-Fault Baseline Sample Sufficiency',
        category: 'BASELINE',
        status: 'INCONCLUSIVE',
        passed: false,
        observed: `${input.baseline.observedCount} samples`,
        threshold: `>= ${minBaselineSamples} samples`,
        reason: `Baseline window recorded only ${input.baseline.observedCount} samples (minimum ${minBaselineSamples} required).`,
        evidenceRef: `phases.baseline:count=${input.baseline.observedCount}`,
      });
      return buildOutput(
        'INCONCLUSIVE',
        'INSUFFICIENT_BASELINE_SAMPLES',
        'Insufficient pre-fault baseline observations to establish healthy reference state.',
        { minBaselineSamples }
      );
    }

    if (input.baseline.serverError5xx > 0 || input.baseline.accepted2xx === 0) {
      checks.push({
        id: 'BASELINE_HEALTHY_REFERENCE',
        name: 'Pre-Fault Baseline Upstream Health',
        category: 'BASELINE',
        status: 'INCONCLUSIVE',
        passed: false,
        observed: `${input.baseline.accepted2xx}/${input.baseline.observedCount} 2xx, ${input.baseline.serverError5xx} 5xx`,
        threshold: '0 5xx errors and >0 2xx responses',
        reason: 'Target route was already unhealthy during pre-fault baseline; experiment cannot isolate fault impact.',
        evidenceRef: `phases.baseline:2xx=${input.baseline.accepted2xx},5xx=${input.baseline.serverError5xx}`,
      });
      return buildOutput(
        'INCONCLUSIVE',
        'UNHEALTHY_BASELINE',
        'Route failed pre-injection baseline health check; verification is inconclusive.',
        { baselineAllowed5xx: 0 }
      );
    }

    checks.push({
      id: 'BASELINE_HEALTHY_REFERENCE',
      name: 'Pre-Fault Baseline Upstream Health',
      category: 'BASELINE',
      status: 'PASS',
      passed: true,
      observed: `${input.baseline.accepted2xx}/${input.baseline.observedCount} 2xx (avg ${input.baseline.avgLatencyMs}ms)`,
      threshold: '0 5xx errors',
      reason: 'Route verified healthy prior to fault injection.',
      evidenceRef: `phases.baseline:count=${input.baseline.observedCount},avgLatencyMs=${input.baseline.avgLatencyMs}`,
    });
  }

  // 6. Policy-Specific Injection Evaluation
  let expectedSpec: Record<string, any> = {};
  let primaryReasonCode = 'VERIFICATION_PASSED';

  if (expType === 'traffic_burst' || expType === 'rate_limit') {
    const rlResult = evaluateRateLimitRule({
      injection: input.injection,
      rateLimitRpm: input.policy.rateLimitRpm,
    });
    checks.push(...rlResult.checks);
    expectedSpec = rlResult.expected;
    primaryReasonCode = rlResult.reasonCode;

    if (rlResult.verdict === 'INCONCLUSIVE') {
      return buildOutput(
        'INCONCLUSIVE',
        rlResult.reasonCode,
        'Rate-limit verification was inconclusive because traffic did not exceed bucket capacity.',
        expectedSpec
      );
    }
  } else if (expType === 'latency') {
    const targetLatencyMs = rawConfig.latencyMs !== undefined ? Number(rawConfig.latencyMs) : 800;
    const gatewayTimeoutMs = Number(rawConfig.gatewayTimeoutMs || process.env.GATEWAY_UPSTREAM_TIMEOUT_MS || 5000);
    const minExpectedObservedLatencyMs = Math.round(targetLatencyMs * 0.75);

    expectedSpec = {
      injectedLatencyMs: targetLatencyMs,
      minObservedAvgLatencyMs: minExpectedObservedLatencyMs,
      gatewayTimeoutCeilingMs: gatewayTimeoutMs,
      allowedServerErrors: targetLatencyMs < gatewayTimeoutMs ? 0 : 'bounded_504_only',
    };

    if (targetLatencyMs < gatewayTimeoutMs) {
      const faultObserved =
        input.injection.avgLatencyMs !== null && input.injection.avgLatencyMs >= minExpectedObservedLatencyMs;
      checks.push({
        id: 'LATENCY_FAULT_OBSERVED',
        name: 'Injected Latency Fault Observed in Telemetry',
        category: 'RESILIENCE',
        status: faultObserved ? 'PASS' : 'FAIL',
        passed: faultObserved,
        observed: `${input.injection.avgLatencyMs ?? 'N/A'}ms avg`,
        threshold: `>= ${minExpectedObservedLatencyMs}ms`,
        reason: faultObserved
          ? `Observed average latency (${input.injection.avgLatencyMs}ms) reflects configured ${targetLatencyMs}ms fault.`
          : `Observed average latency (${input.injection.avgLatencyMs}ms) did not reflect configured ${targetLatencyMs}ms fault.`,
        evidenceRef: `phases.injection:avgLatencyMs=${input.injection.avgLatencyMs}`,
      });

      const noErrors = input.injection.serverError5xx === 0 && input.injection.accepted2xx > 0;
      checks.push({
        id: 'LATENCY_CONTAINMENT_NO_5XX',
        name: 'Zero 5xx Errors Under Sub-Timeout Latency Spike',
        category: 'SLA',
        status: noErrors ? 'PASS' : 'FAIL',
        passed: noErrors,
        observed: `${input.injection.accepted2xx} 2xx, ${input.injection.serverError5xx} 5xx`,
        threshold: '0 5xx errors and >0 2xx responses',
        reason: noErrors
          ? 'Gateway absorbed upstream latency without dropping requests into 5xx failures.'
          : `Gateway produced ${input.injection.serverError5xx} server errors or zero successful responses under latency spike.`,
        evidenceRef: `phases.injection:2xx=${input.injection.accepted2xx},5xx=${input.injection.serverError5xx}`,
      });

      if (!faultObserved) primaryReasonCode = 'FAULT_LATENCY_NOT_OBSERVED';
      else if (!noErrors) primaryReasonCode = 'UNEXPECTED_5XX_UNDER_LATENCY';
    } else {
      const bounded504 =
        input.injection.gatewayTimeout504 > 0 &&
        input.injection.gatewayTimeout504 + input.injection.accepted2xx === input.injection.observedCount;
      checks.push({
        id: 'LATENCY_TIMEOUT_CUTOFF',
        name: 'Gateway Timeout Cutoff Under Excessive Latency',
        category: 'RESILIENCE',
        status: bounded504 ? 'PASS' : 'FAIL',
        passed: bounded504,
        observed: `${input.injection.gatewayTimeout504} 504 timeouts`,
        threshold: '>0 controlled 504 timeouts',
        reason: bounded504
          ? 'Gateway enforced timeout cutoff via controlled HTTP 504.'
          : 'Gateway failed to enforce controlled HTTP 504 timeout cutoff.',
        evidenceRef: `phases.injection:504=${input.injection.gatewayTimeout504}`,
      });
      if (!bounded504) primaryReasonCode = 'TIMEOUT_CUTOFF_NOT_ENFORCED';
    }
  } else if (expType === 'timeout') {
    const maxBoundedCeilingMs = 6500;
    const p95OrAvg = input.injection.percentiles?.p95 ?? input.injection.avgLatencyMs ?? 0;
    expectedSpec = {
      expectedStatusCode: 504,
      expectedTimeouts: input.injection.observedCount,
      maxBoundedLatencyMs: maxBoundedCeilingMs,
    };

    const all504 =
      input.injection.gatewayTimeout504 > 0 &&
      input.injection.gatewayTimeout504 === input.injection.observedCount;
    checks.push({
      id: 'TIMEOUT_504_ENFORCED',
      name: 'Controlled HTTP 504 Timeout Response',
      category: 'RESILIENCE',
      status: all504 ? 'PASS' : 'FAIL',
      passed: all504,
      observed: `${input.injection.gatewayTimeout504}/${input.injection.observedCount} HTTP 504`,
      threshold: `${input.injection.observedCount}/${input.injection.observedCount} HTTP 504`,
      reason: all504
        ? 'All timeout-injected requests terminated cleanly with HTTP 504.'
        : `Expected all ${input.injection.observedCount} requests to return HTTP 504, observed ${input.injection.gatewayTimeout504}.`,
      evidenceRef: `phases.injection:504=${input.injection.gatewayTimeout504},total=${input.injection.observedCount}`,
    });

    const boundedDuration = p95OrAvg <= maxBoundedCeilingMs;
    checks.push({
      id: 'TIMEOUT_DURATION_BOUNDED',
      name: 'Bounded Request Hang Ceiling',
      category: 'SLA',
      status: boundedDuration ? 'PASS' : 'FAIL',
      passed: boundedDuration,
      observed: `${p95OrAvg}ms`,
      threshold: `<= ${maxBoundedCeilingMs}ms`,
      reason: boundedDuration
        ? 'Timeout cutoff prevented unbounded socket hangs.'
        : `Observed P95/avg latency (${p95OrAvg}ms) exceeded timeout ceiling (${maxBoundedCeilingMs}ms).`,
      evidenceRef: `phases.injection:p95=${p95OrAvg}`,
    });

    if (!all504) primaryReasonCode = 'TIMEOUT_504_NOT_ENFORCED';
    else if (!boundedDuration) primaryReasonCode = 'UNBOUNDED_TIMEOUT_DURATION';
  } else if (expType === 'error_5xx') {
    expectedSpec = {
      expectedStatusCode: 503,
      expectedErrors: input.injection.observedCount,
    };

    const controlled503 =
      input.injection.serviceUnavailable503 > 0 &&
      input.injection.serviceUnavailable503 === input.injection.observedCount;
    checks.push({
      id: 'FAULT_503_CONTAINMENT',
      name: 'Controlled HTTP 503 Upstream Fault Containment',
      category: 'RESILIENCE',
      status: controlled503 ? 'PASS' : 'FAIL',
      passed: controlled503,
      observed: `${input.injection.serviceUnavailable503}/${input.injection.observedCount} HTTP 503`,
      threshold: `${input.injection.observedCount}/${input.injection.observedCount} HTTP 503`,
      reason: controlled503
        ? 'Gateway returned deterministic HTTP 503 responses during upstream fault injection.'
        : `Expected ${input.injection.observedCount} controlled HTTP 503 responses, observed ${input.injection.serviceUnavailable503}.`,
      evidenceRef: `phases.injection:503=${input.injection.serviceUnavailable503},total=${input.injection.observedCount}`,
    });

    if (!controlled503) primaryReasonCode = 'FAULT_503_NOT_CONTAINED';
  }

  // 7. Post-Fault Recovery Phase Validation
  const mustVerifyRecovery =
    input.requireRecovery !== undefined
      ? input.requireRecovery
      : expType === 'latency' || expType === 'timeout' || expType === 'error_5xx' || Boolean(input.recovery);

  if (mustVerifyRecovery) {
    if (!input.recovery) {
      checks.push({
        id: 'POST_FAULT_RECOVERY',
        name: 'Post-Fault Gateway Recovery Verification',
        category: 'RECOVERY',
        status: 'INCONCLUSIVE',
        passed: false,
        observed: 'missing recovery window',
        threshold: `>= ${minRecoverySamples} post-fault 2xx samples`,
        reason: 'Post-fault recovery observations were not recorded; refusing to claim recovery without evidence.',
        evidenceRef: 'phases.recovery:missing',
      });
      if (primaryReasonCode === 'VERIFICATION_PASSED') {
        primaryReasonCode = 'MISSING_RECOVERY_EVIDENCE';
      }
    } else {
      const recSent = input.recovery.requestsSent;
      const recCoverageOk =
        recSent === null || recSent === 0 || input.recovery.observedCount >= Math.ceil(recSent * minCoverageRatio);

      if (input.recovery.observedCount < minRecoverySamples || !recCoverageOk) {
        checks.push({
          id: 'POST_FAULT_RECOVERY',
          name: 'Post-Fault Gateway Recovery Verification',
          category: 'RECOVERY',
          status: 'INCONCLUSIVE',
          passed: false,
          observed: `${input.recovery.observedCount} recovery samples`,
          threshold: `>= ${minRecoverySamples} samples (>= ${Math.round(minCoverageRatio * 100)}% coverage)`,
          reason: `Insufficient recovery samples (${input.recovery.observedCount} < ${minRecoverySamples}) to prove post-fault recovery.`,
          evidenceRef: `phases.recovery:count=${input.recovery.observedCount}`,
        });
        if (primaryReasonCode === 'VERIFICATION_PASSED') {
          primaryReasonCode = 'INSUFFICIENT_RECOVERY_SAMPLES';
        }
      } else {
        const baselineRefLatency = input.baseline?.avgLatencyMs ?? 100;
        const maxRecoveredLatencyMs = Math.max(500, baselineRefLatency * 5);
        const latencyRecovered =
          input.recovery.avgLatencyMs !== null && input.recovery.avgLatencyMs <= maxRecoveredLatencyMs;
        const statusRecovered =
          input.recovery.serverError5xx === 0 && input.recovery.accepted2xx === input.recovery.observedCount;
        const recoveryPassed = statusRecovered && latencyRecovered;

        checks.push({
          id: 'POST_FAULT_RECOVERY',
          name: 'Post-Fault Gateway Recovery Verification',
          category: 'RECOVERY',
          status: recoveryPassed ? 'PASS' : 'FAIL',
          passed: recoveryPassed,
          observed: `${input.recovery.accepted2xx}/${input.recovery.observedCount} 2xx, avg ${input.recovery.avgLatencyMs}ms`,
          threshold: `100% 2xx, 0 5xx, avg <= ${maxRecoveredLatencyMs}ms`,
          reason: recoveryPassed
            ? `Gateway recovered cleanly after fault removal${
                input.recoveryDurationMs != null ? ` in ${input.recoveryDurationMs}ms` : ''
              }.`
            : `Gateway failed to recover cleanly after fault removal (${input.recovery.serverError5xx} 5xx, avg ${input.recovery.avgLatencyMs}ms).`,
          evidenceRef: `phases.recovery:2xx=${input.recovery.accepted2xx},5xx=${input.recovery.serverError5xx},recoveryDurationMs=${
            input.recoveryDurationMs ?? 'unknown'
          }`,
        });

        if (!recoveryPassed && primaryReasonCode === 'VERIFICATION_PASSED') {
          primaryReasonCode = 'POST_FAULT_RECOVERY_FAILED';
        }
      }
    }
  }

  const finalVerdict = aggregateVerdicts(checks.map((c) => c.status));
  const summary =
    finalVerdict === 'PASS'
      ? `Verification PASS: Synchronized evidence across ${checks.length} checks confirmed policy enforcement and recovery.`
      : finalVerdict === 'FAIL'
      ? `Verification FAIL (${primaryReasonCode}): Synchronized telemetry proved control breach or recovery failure.`
      : `Verification INCONCLUSIVE (${primaryReasonCode}): Evidence was incomplete or insufficient to establish PASS.`;

  return buildOutput(finalVerdict, primaryReasonCode, summary, expectedSpec);
}
