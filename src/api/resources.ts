import express from 'express';
import os from 'os';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { apiRoutes, experiments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getDependenciesHealth } from './system.js';
import { buildTopology, type ResourceTelemetryPoint } from '../topology/service.js';

export const resourcesRouter = express.Router();

const resourceHistory: ResourceTelemetryPoint[] = [];
let previousCpu = process.cpuUsage();
let previousSampleAt = process.hrtime.bigint();

function sampleResources(): ResourceTelemetryPoint {
  const now = process.hrtime.bigint();
  const elapsedMicros = Number(now - previousSampleAt) / 1_000;
  const currentCpu = process.cpuUsage();
  const cpuMicros = (currentCpu.user - previousCpu.user) + (currentCpu.system - previousCpu.system);

  previousCpu = currentCpu;
  previousSampleAt = now;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuCount = Math.max(1, os.cpus().length);
  const cpu = elapsedMicros > 0
    ? Math.min(100, Math.max(0, (cpuMicros / (elapsedMicros * cpuCount)) * 100))
    : 0;
  const memory = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;
  const heapUsage = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    cpu: Number(cpu.toFixed(2)),
    memory: Number(memory.toFixed(2)),
    heap: heapUsage.heapTotal > 0
      ? Number(((heapUsage.heapUsed / heapUsage.heapTotal) * 100).toFixed(2))
      : 0
  };
}

resourceHistory.push(sampleResources());

const resourceSampler = setInterval(() => {
  resourceHistory.push(sampleResources());
  if (resourceHistory.length > 60) {
    resourceHistory.shift();
  }
}, 5000);

resourceSampler.unref?.();

resourcesRouter.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;

  try {
    const [routes, projectExperiments, dependencyHealth] = await Promise.all([
      db.select({
        id: apiRoutes.id,
        pathPattern: apiRoutes.pathPattern,
        targetUrl: apiRoutes.targetUrl
      })
        .from(apiRoutes)
        .where(eq(apiRoutes.projectId, projectId)),
      db.select({
        id: experiments.id,
        routeId: experiments.routeId,
        type: experiments.type,
        status: experiments.status
      })
        .from(experiments)
        .innerJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
        .where(eq(apiRoutes.projectId, projectId)),
      getDependenciesHealth()
    ]);

    const topology = buildTopology({
      projectId,
      routes,
      experiments: projectExperiments,
      health: {
        postgres: dependencyHealth.postgres.status === 'healthy' ? 'healthy' : 'error',
        redis: dependencyHealth.redis.status === 'healthy' ? 'healthy' : 'error'
      },
      telemetry: resourceHistory.at(-1) ?? null
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...topology,
      telemetryHistory: resourceHistory
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch dynamic topology telemetry'
    });
  }
});
