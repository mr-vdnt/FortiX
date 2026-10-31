import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { experiments, apiRoutes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { enqueueExperiment } from '../experiments/queue.js';
import { z } from 'zod';
import { invalidateExpCache } from '../gateway/index.js';
import { verifyPolicy } from '../verification/engine.js';

const router = express.Router();

const experimentSchema = z.object({
  projectId: z.string().uuid().or(z.string().min(1)),
  routeId: z.string().min(1),
  type: z.enum(['latency', 'error_5xx', 'timeout', 'traffic_burst']),
  config: z.object({
    latencyMs: z.number().min(0).max(30000).optional(),
    durationMs: z.number().min(1000).max(300000).optional()
  }).optional()
});

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  const list = await db.select({
    id: experiments.id,
    routeId: experiments.routeId,
    type: experiments.type,
    status: experiments.status,
    config: experiments.config,
    scheduledFor: experiments.scheduledFor,
    startedAt: experiments.startedAt,
    completedAt: experiments.completedAt,
    createdAt: experiments.createdAt
  }).from(experiments)
    .leftJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
    .where(eq(apiRoutes.projectId, projectId));
    
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
      routeId,
      type,
      status: 'QUEUED',
      config: config || {},
      startedAt: new Date(),
    }).returning();
    
    invalidateExpCache(routeId);

    // Durable worker invocation via BullMQ
    await enqueueExperiment(exp.id);

    res.status(202).json(exp);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: error.issues });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/:id/cancel', requireProjectOwnership, async (req, res) => {
  const experimentId = String(req.params.id);
  const projectId = (req.body?.projectId as string) || (req.query.projectId as string);

  try {
    const [existing] = await db
      .select({
        exp: experiments,
        routeProjectId: apiRoutes.projectId,
      })
      .from(experiments)
      .innerJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
      .where(eq(experiments.id, experimentId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    if (existing.routeProjectId !== projectId) {
      return res.status(403).json({ error: 'Forbidden: Experiment belongs to another project' });
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(existing.exp.status)) {
      return res.status(400).json({ error: `Experiment is already in terminal state ${existing.exp.status}` });
    }

    const cancelledAt = new Date();
    const [updated] = await db
      .update(experiments)
      .set({
        status: 'CANCELLED',
        completedAt: cancelledAt,
      })
      .where(eq(experiments.id, experimentId))
      .returning();

    // Immediately deactivate any active gateway fault injection for this route
    invalidateExpCache(existing.exp.routeId);

    const verification = await verifyPolicy(
      experimentId,
      null,
      existing.exp.startedAt ? new Date(existing.exp.startedAt) : cancelledAt,
      cancelledAt
    );

    res.json({
      message: 'Experiment cancelled, active faults removed, and INCONCLUSIVE verification recorded',
      experiment: updated,
      verification,
    });
  } catch (error) {
    console.error('[Experiments API] Failed to cancel experiment:', error);
    res.status(500).json({ error: 'Failed to cancel experiment' });
  }
});

export const experimentsRouter = router;
