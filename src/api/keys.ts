import express from 'express';
import { db } from '../db/index.js';
import { apiKeys, projects } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { requireProjectOwnership } from './projects.js';
import { z } from 'zod';
import crypto from 'crypto';
import { invalidateApiKeyCache } from '../gateway/index.js';
import { publishKeyRevocation } from '../lib/key-invalidation.js';

const router = express.Router();

router.get('/', requireProjectOwnership, async (req, res) => {
  const projectId = req.query.projectId as string;
  try {
    const list = await db.select({
      id: apiKeys.id,
      projectId: apiKeys.projectId,
      keyPrefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      purpose: apiKeys.purpose,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt
    }).from(apiKeys).where(eq(apiKeys.projectId, projectId));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

const keySchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

router.post('/', requireProjectOwnership, async (req, res) => {
  try {
    const { projectId, name, purpose, scopes, expiresInDays } = keySchema.parse(req.body);
    
    // Get project to determine environment
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const envPrefix = project.environment === 'production' ? 'live' : 'test';
    const keyId = crypto.randomBytes(8).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    
    const keyPrefix = `fx_${envPrefix}_${keyId}`;
    const rawKey = `${keyPrefix}_${secret}`;
    const secretHash = await bcrypt.hash(secret, 10);
    
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }
    
    const [newKey] = await db.insert(apiKeys).values({
      id: keyId,
      projectId,
      keyPrefix,
      secretHash,
      name,
      purpose,
      scopes: scopes || [],
      expiresAt,
      revokedAt: null
    }).returning();
    
    res.status(201).json({
      id: newKey.id,
      projectId: newKey.projectId,
      name: newKey.name,
      keyPrefix: newKey.keyPrefix,
      purpose: newKey.purpose,
      scopes: newKey.scopes,
      expiresAt: newKey.expiresAt,
      createdAt: newKey.createdAt,
      rawKey // Only returned once
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.issues });
    }
    console.error('Failed to create key:', error);
    res.status(500).json({ error: 'Failed to create key' });
  }
});

router.post('/:id/revoke', requireProjectOwnership, async (req, res) => {
  const { id } = req.params;
  const projectId = req.body.projectId;
  try {
    const [updated] = await db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id as string), eq(apiKeys.projectId, projectId)))
      .returning();
      
    if (!updated) return res.status(404).json({ error: 'Key not found' });
    
    // Invalidate local in-process cache
    invalidateApiKeyCache(id as string, projectId);

    // Broadcast across distributed gateway instances via Redis Pub/Sub
    await publishKeyRevocation({
      event: 'api_key.revoked',
      keyId: id as string,
      projectId,
      timestamp: new Date().toISOString(),
      reason: 'manual_revoke'
    });

    res.json({ success: true, revokedAt: updated.revokedAt });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

router.post('/revoke-all', requireProjectOwnership, async (req, res) => {
  const projectId = req.body.projectId;
  try {
    await db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));
    
    // Invalidate local in-process cache for project
    invalidateApiKeyCache(undefined, projectId);

    // Broadcast distributed project key revocation via Redis Pub/Sub
    await publishKeyRevocation({
      event: 'api_key.revoked_all',
      projectId,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke keys' });
  }
});

export const apiKeysRouter = router;
