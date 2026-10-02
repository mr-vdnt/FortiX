import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { verifications, experiments, apiRoutes } from '../db/schema.js';
import { inArray, desc, eq } from 'drizzle-orm';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const exps = await db.select({ id: experiments.id })
      .from(experiments)
      .leftJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
      .where(eq(apiRoutes.projectId, projectId));
      
    const expIds = exps.map(e => e.id);
    
    if (expIds.length === 0) return res.json([]);
    
    const verifs = await db.select().from(verifications)
      .where(inArray(verifications.experimentId, expIds))
      .orderBy(desc(verifications.createdAt));
      
    res.json(verifs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verifications' });
  }
});

export const verificationsRouter = router;
