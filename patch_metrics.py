import os

content = """import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { metricLogs, apiRoutes } from '../db/schema.js';
import { eq, inArray, desc } from 'drizzle-orm';
import { calculateScores } from '../scoring/index.js';

const router = express.Router();

// Helper to calculate precise percentiles (e.g., P50, P95) from raw observations
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
  } else {
    return Math.round(sorted[base]);
  }
}

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const routes = await db.select({ id: apiRoutes.id }).from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
    const routeIds = routes.map(r => r.id);
    if (routeIds.length === 0) return res.json([]);

    // Fetch the raw telemetry events
    const metrics = await db.select().from(metricLogs)
      .where(inArray(metricLogs.routeId, routeIds))
      .orderBy(desc(metricLogs.timestamp))
      .limit(2000);

    if (metrics.length === 0) return res.json([]);

    // Aggregate into 1-second buckets
    const buckets = new Map<string, typeof metrics>();
    
    metrics.forEach(m => {
      // Normalize timestamp to the nearest second
      const date = new Date(m.timestamp);
      date.setMilliseconds(0);
      const bucketKey = date.toISOString();
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(m);
    });

    const formatted = Array.from(buckets.entries()).map(([timeKey, items]) => {
      const latencies = items.map(i => i.latencyMs);
      const errorCount = items.filter(i => i.error || i.statusCode >= 400).length;
      
      return {
        timestamp: new Date(timeKey).toLocaleTimeString(),
        latency: percentile(latencies, 0.95), // P95 Latency for this window
        p50: percentile(latencies, 0.50),     // P50 Latency for this window
        errorRate: Math.round((errorCount / items.length) * 100),
        requestRate: items.length,            // Throughput (req/sec)
        activeFaults: items.some(i => i.experimentId) ? 1 : 0
      };
    }).reverse(); // Latest buckets at the end for the UI chart

    // Return the latest 60 buckets (1 minute of live data)
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

export const metricsRouter = router;
"""

with open('src/api/metrics.ts', 'w') as f:
    f.write(content)

print("Metrics Aggregation successfully patched.")
