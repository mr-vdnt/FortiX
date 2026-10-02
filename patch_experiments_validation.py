import os

content = open('src/api/experiments.ts').read()

new_content = """import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { experiments, apiRoutes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { runExperimentLogic } from '../experiments/worker.js';
import { z } from 'zod';

const router = express.Router();

const experimentSchema = z.object({
  projectId: z.string().uuid(),
  routeId: z.string().uuid(),
  type: z.enum(['latency', 'error_5xx', 'timeout', 'traffic_burst']),
  config: z.object({
    latencyMs: z.number().min(0).max(30000).optional(),
    durationMs: z.number().min(1000).max(300000).optional()
  }).optional()
});

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  const list = await db.select().from(experiments).where(eq(experiments.projectId, projectId));
  res.json(list);
});

router.post('/', requireProjectOwnership, async (req, res) => {
  try {
    const validatedData = experimentSchema.parse(req.body);
    const { projectId, routeId, type, config } = validatedData;
    
    const [routeInfo] = await db.select().from(apiRoutes).where(and(eq(apiRoutes.id, routeId), eq(apiRoutes.projectId, projectId)));
    if (!routeInfo) {
      return res.status(403).json({ error: 'Forbidden: Route does not belong to project' });
    }

    const [exp] = await db.insert(experiments).values({
      id: uuidv4(),
      projectId,
      routeId,
      type,
      status: 'QUEUED',
      config,
      startedAt: new Date(),
    }).returning();
    
    // Asynchronous worker invocation
    setTimeout(() => {
      runExperimentLogic(exp.id).catch(console.error);
    }, 100);

    res.status(202).json(exp);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export const experimentsRouter = router;
"""

open('src/api/experiments.ts', 'w').write(new_content)
print("Added validation to experiments API")
