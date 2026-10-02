import { db } from '../db/index.js';
import { verifications, metricLogs, securityPolicies, experiments } from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function verifyPolicy(experimentId: string, policyId: string, startTime: Date, endTime: Date) {
  const metrics = await db.select().from(metricLogs).where(
    and(
      eq(metricLogs.experimentId, experimentId),
      gte(metricLogs.timestamp, startTime),
      lte(metricLogs.timestamp, endTime)
    )
  );
  
  const [policy] = await db.select().from(securityPolicies).where(eq(securityPolicies.id, policyId));
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  
  if (!policy || !exp) return;
  
  const total = metrics.length;
  const accepted = metrics.filter(m => m.statusCode >= 200 && m.statusCode < 300).length;
  const rejected = metrics.filter(m => m.statusCode === 429 || m.statusCode === 403 || m.statusCode === 401).length;
  const error = metrics.filter(m => m.statusCode >= 500).length;
  
  let expected: any = {};
  let verdict = 'FAILED';
  
  if (exp.type === 'latency' || exp.type === 'timeout') {
    // We expect the system to handle it or time out
    expected = { maxLatencyMs: (exp.config as any)?.latencyMs || 6000, allowedErrors: 0 };
    const avgLatency = metrics.reduce((a, b) => a + b.latencyMs, 0) / (total || 1);
    if (avgLatency >= ((exp.config as any)?.latencyMs || 800) * 0.8) {
        verdict = 'PASSED';
    }
  } else if (exp.type === 'error_5xx') {
    expected = { expectedErrors: total, expectedStatusCode: 503 };
    if (error > 0 && error === total) {
        verdict = 'PASSED';
    }
  } else {
    // rate limit
    const expectedRejected = Math.max(0, total - (policy.rateLimitRpm || 20));
    expected = { expectedRejected, maxAccepted: policy.rateLimitRpm || 20 };
    if (rejected >= expectedRejected - 10) {
        verdict = 'PASSED';
    }
  }
  
  const observed = { total, accepted, rejected, error, avgLatencyMs: metrics.reduce((a, b) => a + b.latencyMs, 0) / (total || 1) };
  
  const [verification] = await db.insert(verifications).values({
    id: uuidv4(),
    experimentId,
    expected,
    observed,
    verdict
  }).returning();
  
  return verification;
}
