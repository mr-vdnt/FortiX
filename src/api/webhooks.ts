import express from 'express';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const router = express.Router();

const webhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()),
  isActive: z.boolean().default(true),
});

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = String(req.query.projectId);
  try {
    const list = await db.select().from(webhooks).where(eq(webhooks.projectId, projectId));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

router.post('/', requireProjectOwnership, async (req, res) => {
  const projectId = String(req.query.projectId);
  try {
    const data = webhookSchema.parse(req.body);
    const newWebhook = {
      id: uuidv4(),
      projectId,
      ...data,
    };
    await db.insert(webhooks).values(newWebhook);
    res.json(newWebhook);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues });
    }
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.delete('/:id', requireProjectOwnership, async (req, res) => {
  const projectId = String(req.query.projectId);
  const id = req.params.id as string;
  try {
    await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.projectId, projectId)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

router.patch('/:id/toggle', requireProjectOwnership, async (req, res) => {
  const projectId = String(req.query.projectId);
  const id = req.params.id as string;
  const { isActive } = req.body;
  try {
    await db.update(webhooks).set({ isActive }).where(and(eq(webhooks.id, id), eq(webhooks.projectId, projectId)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

export const webhooksRouter = router;
