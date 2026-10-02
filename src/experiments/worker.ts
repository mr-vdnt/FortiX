import { db } from '../db/index.js';
import { experiments, metricLogs, apiRoutes, securityPolicies, apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { verifyPolicy } from '../verification/engine.js';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

dotenv.config({ override: true });

async function generateTempApiKey(projectId: string) {
  const keyId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = await bcrypt.hash(secret, 10);
  const keyPrefix = `fx_test_${keyId}`;
  
  await db.insert(apiKeys).values({
    id: keyId,
    projectId,
    keyPrefix,
    name: 'Experiment Worker Key',
    secretHash,
    createdAt: new Date()
  });
  
  return { id: keyId, raw: `${keyPrefix}_${secret}` };
}

async function runLatencyExperiment(targetUrl: string, expId: string, routeId: string, durationMs: number, projectId: string) {
  let tempKey;
  let headers: Record<string, string> = { 'x-experiment-id': expId };
  
  try {
    tempKey = await generateTempApiKey(projectId);
    headers['x-api-key'] = tempKey.raw;
    
    const endTime = Date.now() + durationMs;
    let calls = 0;
    
    // Burst traffic
    while (Date.now() < endTime && calls < 200) {
      calls++;
      try {
        await fetch(targetUrl, { headers });
      } catch (e) {
        // Network error, the gateway wasn't even reached.
        console.error('Fetch error:', e);
      }
      await new Promise(r => setTimeout(r, 50)); // Fire rapidly
    }
  } finally {
    if (tempKey) {
      await db.delete(apiKeys).where(eq(apiKeys.id, tempKey.id));
    }
  }
}

export async function runExperimentLogic(experimentId: string) {
  console.log(`Starting experiment ${experimentId}`);
  
  await db.update(experiments).set({ status: 'RUNNING', startedAt: new Date() }).where(eq(experiments.id, experimentId));
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  const [route] = await db.select().from(apiRoutes).where(eq(apiRoutes.id, exp.routeId));
  
  if (!route) {
    await db.update(experiments).set({ status: 'FAILED', completedAt: new Date() }).where(eq(experiments.id, experimentId));
    return;
  }
  
  const target = `http://127.0.0.1:${process.env.PORT || 3000}/proxy/${route.id}`;
  const startTime = new Date();
  
  try {
    if (exp.type === 'latency' || exp.type === 'error_5xx' || exp.type === 'timeout') {
      const expDuration = Math.min((exp.config as any)?.durationMs || 5000, 5000);
      await runLatencyExperiment(target, exp.id, exp.routeId, expDuration, route.projectId);
    }
    
    // ANALYZING STATE
    await db.update(experiments).set({ status: 'ANALYZING' }).where(eq(experiments.id, experimentId));
    const endTime = new Date();
    
    // Run verification if a policy exists
    const [policy] = await db.select().from(securityPolicies).where(eq(securityPolicies.routeId, exp.routeId));
    if (policy) {
      await verifyPolicy(exp.id, policy.id, startTime, endTime);
    }
    
    await db.update(experiments).set({ status: 'COMPLETED', completedAt: new Date() }).where(eq(experiments.id, experimentId));
  } catch (error) {
    console.error('Experiment failed:', error);
    await db.update(experiments).set({ status: 'FAILED', completedAt: new Date() }).where(eq(experiments.id, experimentId));
  }
}
