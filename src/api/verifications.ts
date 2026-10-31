import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { verifications, experiments, apiRoutes } from '../db/schema.js';
import { inArray, desc, eq } from 'drizzle-orm';
import { normalizeVerdict } from '../verification/domain.js';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const exps = await db
      .select({ id: experiments.id })
      .from(experiments)
      .leftJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
      .where(eq(apiRoutes.projectId, projectId));

    const expIds = exps.map((e) => e.id);

    if (expIds.length === 0) return res.json([]);

    const verifs = await db
      .select()
      .from(verifications)
      .where(inArray(verifications.experimentId, expIds))
      .orderBy(desc(verifications.createdAt));

    res.json(
      verifs.map((v) => ({
        ...v,
        verdict: normalizeVerdict(v.verdict),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verifications' });
  }
});

router.get('/:id', requireProjectOwnership, async (req, res) => {
  const verificationId = String(req.params.id);
  const projectId = req.query.projectId as string;

  try {
    const [row] = await db
      .select({
        verification: verifications,
        routeProjectId: apiRoutes.projectId,
      })
      .from(verifications)
      .innerJoin(experiments, eq(verifications.experimentId, experiments.id))
      .innerJoin(apiRoutes, eq(experiments.routeId, apiRoutes.id))
      .where(eq(verifications.id, verificationId))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: 'Verification record not found' });
    }

    if (row.routeProjectId !== projectId) {
      return res.status(403).json({ error: 'Forbidden: Verification belongs to another project' });
    }

    res.json({
      ...row.verification,
      verdict: normalizeVerdict(row.verification.verdict),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification record' });
  }
});

export const verificationsRouter = router;
