import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { securityEvents, apiRoutes } from '../db/schema.js';
import { eq, inArray, desc, and, SQL, ilike, or } from 'drizzle-orm';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  
  const typeFilter = req.query.threatType as string;
  const search = req.query.search as string;
  const eventId = req.query.eventId as string; // specific event details

  try {
    const routes = await db.select({ id: apiRoutes.id }).from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
    const routeIds = routes.map(r => r.id);

    if (routeIds.length === 0) return res.json({ events: [], total: 0 });

    if (eventId) {
      const [event] = await db.select().from(securityEvents).where(and(eq(securityEvents.id, eventId), inArray(securityEvents.routeId, routeIds))).limit(1);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      return res.json(event);
    }

    const conditions: SQL[] = [inArray(securityEvents.routeId, routeIds)];
    if (typeFilter) conditions.push(eq(securityEvents.threatType, typeFilter));
    
    if (search) {
      conditions.push(
        or(
          ilike(securityEvents.threatType, `%${search}%`),
          ilike(securityEvents.id, `%${search}%`),
          ilike(securityEvents.routeId, `%${search}%`)
        ) as SQL
      );
    }

    const rawEvents = await db.select().from(securityEvents)
      .where(and(...conditions))
      .orderBy(desc(securityEvents.timestamp))
      .limit(limit)
      .offset(offset);

    const events = rawEvents.map(e => {
      const payload = (e.payload as any) || {};
      return {
        id: e.id,
        routeId: e.routeId,
        threatType: e.threatType,
        type: e.threatType,
        requestId: e.requestId,
        timestamp: e.timestamp,
        severity: payload.severity || 'HIGH',
        action: payload.action || 'BLOCKED',
        sourceIp: payload.sourceIp || 'Internal Gateway',
        payload
      };
    });

    res.json({ events });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export const eventsRouter = router;
