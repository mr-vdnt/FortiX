import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { metricLogs, apiRoutes, experiments, verifications } from '../db/schema.js';
import { eq, inArray, desc } from 'drizzle-orm';
import { calculateScores } from '../scoring/index.js';
import { percentile } from '../lib/math.js';
import {
  computePhaseMetrics,
  MIN_PERCENTILE_SAMPLES,
  normalizeVerdict,
  PhaseWindowMetrics,
} from '../verification/domain.js';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const routes = await db.select({ id: apiRoutes.id }).from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
    const routeIds = routes.map((r) => r.id);
    if (routeIds.length === 0) return res.json([]);

    const metrics = await db
      .select()
      .from(metricLogs)
      .where(inArray(metricLogs.routeId, routeIds))
      .orderBy(desc(metricLogs.timestamp))
      .limit(2000);

    if (metrics.length === 0) return res.json([]);

    const buckets = new Map<string, typeof metrics>();

    metrics.forEach((m) => {
      const date = new Date(m.timestamp);
      date.setMilliseconds(0);
      const bucketKey = date.toISOString();
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(m);
    });

    const formatted = Array.from(buckets.entries())
      .map(([timeKey, items]) => {
        const latencies = items.map((i) => i.latencyMs);
        const errorCount = items.filter((i) => i.statusCode >= 400).length;

        return {
          timestamp: new Date(timeKey).toLocaleTimeString(),
          latency: percentile(latencies, 0.95),
          p50: percentile(latencies, 0.50),
          errorRate: Math.round((errorCount / items.length) * 100),
          requestRate: items.length,
          activeFaults: items.some((i) => i.experimentId) ? 1 : 0,
        };
      })
      .reverse();

    res.json(formatted.slice(-60));
  } catch (error) {
    console.error('[Metrics API] Error aggregating metrics:', error);
    res.status(500).json({ error: 'Failed to fetch and aggregate metrics' });
  }
});

router.get('/scores', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const scores = await calculateScores(projectId);
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate scores' });
  }
});

// GET /api/control/metrics/resilience-summary
router.get('/resilience-summary', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const routes = await db.select({ id: apiRoutes.id }).from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
    const routeIds = routes.map((r) => r.id);

    if (routeIds.length === 0) {
      return res.json({
        hasExperiments: false,
        globalScore: 100,
        availability: null,
        mttrSeconds: null,
        faultContainment: null,
        gatewayOverhead: { directMs: null, fortixMs: null, overheadMs: null },
        liveTelemetry: { p50Ms: null, p95Ms: null, errorRate: null, sampleCount: 0 },
        comparison: null,
      });
    }

    const scores = await calculateScores(projectId);

    const [latestExp] = await db
      .select()
      .from(experiments)
      .where(inArray(experiments.routeId, routeIds))
      .orderBy(desc(experiments.createdAt))
      .limit(1);

    const allMetrics = await db
      .select()
      .from(metricLogs)
      .where(inArray(metricLogs.routeId, routeIds))
      .orderBy(desc(metricLogs.timestamp))
      .limit(1000);

    const liveWindow = computePhaseMetrics('INJECTION', allMetrics, {
      minPercentileSamples: MIN_PERCENTILE_SAMPLES,
    });

    const p50 = liveWindow.percentiles?.p50 ?? null;
    const p95 = liveWindow.percentiles?.p95 ?? null;
    const errorRate = liveWindow.errorRatePercent;
    const availability = liveWindow.availabilityPercent;

    let comparison = null;
    let mttrSeconds: number | null = null;
    let faultContainment: number | null = null;

    if (latestExp) {
      const [latestVerif] = await db
        .select()
        .from(verifications)
        .where(eq(verifications.experimentId, latestExp.id))
        .orderBy(desc(verifications.createdAt))
        .limit(1);

      const observedObj = (latestVerif?.observed || {}) as Record<string, any>;
      const recordedPhases = (observedObj.phases || {}) as {
        baseline?: PhaseWindowMetrics | null;
        injection?: PhaseWindowMetrics | null;
        recovery?: PhaseWindowMetrics | null;
      };

      const expMetricsRaw = allMetrics.filter((m) => m.experimentId === latestExp.id);
      const injectionPhase: PhaseWindowMetrics =
        recordedPhases.injection ||
        computePhaseMetrics('INJECTION', expMetricsRaw, { minPercentileSamples: MIN_PERCENTILE_SAMPLES });
      const baselinePhase: PhaseWindowMetrics | null = recordedPhases.baseline ?? null;
      const recoveryPhase: PhaseWindowMetrics | null = recordedPhases.recovery ?? null;

      if (typeof observedObj.recoveryDurationMs === 'number' && observedObj.recoveryDurationMs >= 0) {
        mttrSeconds = Math.round((observedObj.recoveryDurationMs / 1000) * 100) / 100;
      }

      if (injectionPhase.observedCount > 0 && injectionPhase.availabilityPercent !== null) {
        faultContainment = injectionPhase.availabilityPercent;
      }

      const baselineLat = baselinePhase?.percentiles?.p95 ?? baselinePhase?.avgLatencyMs ?? null;
      const faultLat = injectionPhase.percentiles?.p95 ?? injectionPhase.avgLatencyMs ?? null;
      const recoveryLat = recoveryPhase?.percentiles?.p95 ?? recoveryPhase?.avgLatencyMs ?? null;

      const baselineErr = baselinePhase?.errorRatePercent ?? null;
      const faultErr = injectionPhase.errorRatePercent ?? null;
      const recoveryErr = recoveryPhase?.errorRatePercent ?? null;

      const baselineAvail = baselinePhase?.availabilityPercent ?? null;
      const faultAvail = injectionPhase.availabilityPercent ?? null;
      const recoveryAvail = recoveryPhase?.availabilityPercent ?? null;

      const latencyDelta =
        baselineLat !== null && faultLat !== null && baselineLat > 0
          ? `${faultLat >= baselineLat ? '+' : ''}${Math.round(((faultLat - baselineLat) / baselineLat) * 100)}%`
          : 'INSUFFICIENT_DATA';

      const errDelta =
        baselineErr !== null && faultErr !== null
          ? `${faultErr >= baselineErr ? '+' : ''}${Math.round((faultErr - baselineErr) * 10) / 10} pp`
          : 'INSUFFICIENT_DATA';

      const availDelta =
        baselineAvail !== null && faultAvail !== null
          ? `${faultAvail >= baselineAvail ? '+' : ''}${Math.round((faultAvail - baselineAvail) * 10) / 10} pp`
          : 'INSUFFICIENT_DATA';

      comparison = {
        experimentName: `${latestExp.type.toUpperCase()} Experiment`,
        status: latestExp.status,
        verdict: latestVerif ? normalizeVerdict(latestVerif.verdict) : 'INCONCLUSIVE',
        latency: {
          baseline: baselineLat !== null ? `${baselineLat} ms` : 'INSUFFICIENT_DATA',
          fault: faultLat !== null ? `${faultLat} ms` : 'INSUFFICIENT_DATA',
          recovery: recoveryLat !== null ? `${recoveryLat} ms` : 'INSUFFICIENT_DATA',
          delta: latencyDelta,
        },
        errorRate: {
          baseline: baselineErr !== null ? `${baselineErr}%` : 'INSUFFICIENT_DATA',
          fault: faultErr !== null ? `${faultErr}%` : 'INSUFFICIENT_DATA',
          recovery: recoveryErr !== null ? `${recoveryErr}%` : 'INSUFFICIENT_DATA',
          delta: errDelta,
        },
        availability: {
          baseline: baselineAvail !== null ? `${baselineAvail}%` : 'INSUFFICIENT_DATA',
          fault: faultAvail !== null ? `${faultAvail}%` : 'INSUFFICIENT_DATA',
          recovery: recoveryAvail !== null ? `${recoveryAvail}%` : 'INSUFFICIENT_DATA',
          delta: availDelta,
        },
      };
    }

    res.json({
      hasExperiments: !!latestExp,
      globalScore: scores.resilienceScore,
      availability,
      mttrSeconds,
      faultContainment,
      gatewayOverhead: {
        directMs: null,
        fortixMs: p50,
        overheadMs: null,
      },
      liveTelemetry: {
        p50Ms: p50,
        p95Ms: p95,
        errorRate,
        sampleCount: liveWindow.observedCount,
      },
      comparison,
    });
  } catch (error) {
    console.error('[Metrics API] Error in resilience summary:', error);
    res.status(500).json({ error: 'Failed to generate resilience summary' });
  }
});

export const metricsRouter = router;
