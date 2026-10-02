import { z } from 'zod';
import express from 'express';
import { db } from '../db/index.js';
import { securityPolicies, apiRoutes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireProjectOwnership } from './projects.js';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  const list = await db.select({
    id: securityPolicies.id,
    routeId: securityPolicies.routeId,
    rateLimitRpm: securityPolicies.rateLimitRpm,
    enableWaf: securityPolicies.enableWaf,
    enableSsrf: securityPolicies.enableSsrf,
    createdAt: securityPolicies.createdAt
  }).from(securityPolicies)
    .leftJoin(apiRoutes, eq(securityPolicies.routeId, apiRoutes.id))
    .where(eq(apiRoutes.projectId, projectId));
  res.json(list);
});

router.post('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.body.projectId;
  try {
    const { routeId, rateLimitRpm, enableWaf, enableSsrf } = z.object({
      routeId: z.string().min(1),
      rateLimitRpm: z.number().int().nullable().optional(),
      enableWaf: z.boolean().default(false),
      enableSsrf: z.boolean().default(false)
    }).parse(req.body);
    
    // Ensure route belongs to project
    const [route] = await db.select().from(apiRoutes).where(and(eq(apiRoutes.id, routeId), eq(apiRoutes.projectId, projectId))).limit(1);
    if (!route) return res.status(404).json({ error: 'Route not found' });
    
    // Delete existing policy for route
    await db.delete(securityPolicies).where(eq(securityPolicies.routeId, routeId));
    
    const [newPolicy] = await db.insert(securityPolicies).values({
      id: uuidv4(),
      routeId,
      rateLimitRpm: rateLimitRpm || null,
      enableWaf,
      enableSsrf
    }).returning();
    
    res.status(201).json(newPolicy);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    }
    res.status(500).json({ error: 'Failed to save policy' });
  }
});

router.delete('/:id', requireProjectOwnership, async (req, res) => {
  const { id } = req.params;
  const projectId = req.body.projectId;
  try {
    // Need to verify ownership via join
    const [policy] = await db.select({ id: securityPolicies.id })
      .from(securityPolicies)
      .leftJoin(apiRoutes, eq(securityPolicies.routeId, apiRoutes.id))
      .where(and(eq(securityPolicies.id, id as string), eq(apiRoutes.projectId, projectId)))
      .limit(1);
      
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
      
    await db.delete(securityPolicies).where(eq(securityPolicies.id, id as string));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

export const policiesRouter = router;
