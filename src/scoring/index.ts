import { db } from '../db/index.js';
import { verifications, metricLogs, experiments, apiRoutes, securityEvents } from '../db/schema.js';
import { eq, inArray, desc } from 'drizzle-orm';
import { percentile } from '../lib/math.js';

export interface ScoreEvidence {
  securityScore: number;
  resilienceScore: number;
  apiHealth: number;
  hasEvidence: boolean;
  totalVerifications: number;
  passedVerifications: number;
  failedVerifications: number;
  liveStats: {
    p50LatencyMs: number;
    p95LatencyMs: number;
    errorRatePercent: number;
    availabilityPercent: number;
    totalRequests: number;
  };
}

export async function calculateScores(projectId: string): Promise<ScoreEvidence> {
  const routes = await db.select({ id: apiRoutes.id }).from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
  const routeIds = routes.map(r => r.id);

  if (routeIds.length === 0) {
    return {
      securityScore: 100,
      resilienceScore: 100,
      apiHealth: 100,
      hasEvidence: false,
      totalVerifications: 0,
      passedVerifications: 0,
      failedVerifications: 0,
      liveStats: {
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        errorRatePercent: 0,
        availabilityPercent: 100,
        totalRequests: 0
      }
    };
  }

  // Fetch experiments and verifications
  const projectExps = await db.select()
    .from(experiments)
    .where(inArray(experiments.routeId, routeIds))
    .orderBy(desc(experiments.createdAt))
    .limit(20);
    
  const expIds = projectExps.map(e => e.id);
  const verifs = expIds.length > 0 
    ? await db.select().from(verifications).where(inArray(verifications.experimentId, expIds)) 
    : [];

  // Fetch recent telemetry metrics
  const recentMetrics = await db.select()
    .from(metricLogs)
    .where(inArray(metricLogs.routeId, routeIds))
    .orderBy(desc(metricLogs.timestamp))
    .limit(500);

  const latencies = recentMetrics.map(m => m.latencyMs);
  const totalReqs = recentMetrics.length;
  const errorCount = recentMetrics.filter(m => m.statusCode >= 500).length;
  const clientErrorCount = recentMetrics.filter(m => m.statusCode >= 400 && m.statusCode < 500).length;

  const p50 = latencies.length > 0 ? percentile(latencies, 0.50) : 0;
  const p95 = latencies.length > 0 ? percentile(latencies, 0.95) : 0;
  const errorRate = totalReqs > 0 ? Math.round((errorCount / totalReqs) * 1000) / 10 : 0;
  const availability = totalReqs > 0 ? Math.round(((totalReqs - errorCount) / totalReqs) * 1000) / 10 : 100;

  // Security Verifications: Rate limits, auth, threat blocks
  const securityVerifs = verifs.filter(v => {
    const exp = projectExps.find(e => e.id === v.experimentId);
    return exp?.type === 'rate_limit' || exp?.type === 'auth' || exp?.type === 'threat';
  });

  // Resilience Verifications: Latency, timeout, 5xx faults
  const resilienceVerifs = verifs.filter(v => {
    const exp = projectExps.find(e => e.id === v.experimentId);
    return exp?.type === 'latency' || exp?.type === 'timeout' || exp?.type === 'error_5xx';
  });

  const passedSec = securityVerifs.filter(v => v.verdict === 'PASSED').length;
  const failedSec = securityVerifs.filter(v => v.verdict !== 'PASSED').length;

  const passedRes = resilienceVerifs.filter(v => v.verdict === 'PASSED').length;
  const failedRes = resilienceVerifs.filter(v => v.verdict !== 'PASSED').length;

  // Derive Security Score:
  // Base 100. Deduct 15 points per failed security verification.
  let securityScore = 100;
  if (securityVerifs.length > 0) {
    securityScore = Math.max(0, Math.round(100 - (failedSec * 20)));
  }

  // Derive Resilience Score:
  // Evaluates actual latency degradation, 5xx fault rates, and verification outcomes.
  let resilienceScore = 100;
  if (verifs.length > 0 || recentMetrics.length > 0) {
    let penalty = 0;
    // Failed verification penalty (15 pts per failed resilience test)
    penalty += failedRes * 15;
    
    // Latency degradation penalty: if P95 exceeds 300ms, deduct points
    if (p95 > 500) {
      penalty += Math.min(30, Math.round((p95 - 500) / 25));
    } else if (p95 > 200) {
      penalty += Math.min(15, Math.round((p95 - 200) / 30));
    }

    // Availability/5xx error penalty
    if (errorRate > 0) {
      penalty += Math.min(40, Math.round(errorRate * 2));
    }

    resilienceScore = Math.max(10, Math.min(100, 100 - penalty));
  }

  // API Health: reflects current error-free throughput
  const dynamicHealth = totalReqs > 0 
    ? Math.max(0, Math.min(100, Math.round(((totalReqs - (errorCount + clientErrorCount * 0.2)) / totalReqs) * 100))) 
    : 100;

  return {
    securityScore,
    resilienceScore,
    apiHealth: dynamicHealth,
    hasEvidence: verifs.length > 0,
    totalVerifications: verifs.length,
    passedVerifications: verifs.filter(v => v.verdict === 'PASSED').length,
    failedVerifications: verifs.filter(v => v.verdict !== 'PASSED').length,
    liveStats: {
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      errorRatePercent: errorRate,
      availabilityPercent: availability,
      totalRequests: totalReqs
    }
  };
}
