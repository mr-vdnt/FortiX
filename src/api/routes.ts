import express from 'express';
import { db } from '../db/index.js';
import { apiRoutes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireProjectOwnership } from './projects.js';
import { isSafeTarget } from '../gateway/ssrf.js';
import { z } from 'zod';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const list = await db.select().from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

const routeSchema = z.object({
  projectId: z.string().min(1),
  pathPattern: z.string().min(1),
  targetUrl: z.string().url()
});

router.post('/', requireProjectOwnership, async (req, res) => {
  try {
    const { projectId, pathPattern, targetUrl } = routeSchema.parse(req.body);

    if (!isSafeTarget(targetUrl)) {
      return res.status(400).json({ error: 'Target URL is not permitted by security policy (SSRF protection)' });
    }
    
    const [newRoute] = await db.insert(apiRoutes).values({
      id: uuidv4(),
      projectId,
      pathPattern,
      targetUrl
    }).returning();
    
    res.status(201).json(newRoute);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues });
    }
    res.status(500).json({ error: 'Failed to create route' });
  }
});

router.delete('/:id', requireProjectOwnership, async (req, res) => {
  const { id } = req.params;
  const projectId = req.body.projectId || req.query.projectId;
  try {
    await db.delete(apiRoutes).where(and(eq(apiRoutes.id, id as string), eq(apiRoutes.projectId, projectId as string)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

export const apiRoutesRouter = router;
