import express from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { exportWorkspaceBackup, verifyWorkspaceBackupIntegrity } from '../db/backup.js';

const router = express.Router();

router.get('/users', async (_req: AuthRequest, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users);

    res.json({ users: allUsers });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

const roleUpdateSchema = z.object({
  role: z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']),
});

router.patch('/users/:id/role', async (req: AuthRequest, res) => {
  try {
    const rawId = req.params.id;
    const targetUserId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!targetUserId) {
      return res.status(400).json({ error: 'Missing user ID' });
    }
    const { role } = roleUpdateSchema.parse(req.body);

    if (targetUserId === req.user?.id && role !== 'ADMIN') {
      return res.status(400).json({ error: 'Administrators cannot demote their own active account.' });
    }

    const [existing] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetUserId))
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        emailVerified: users.emailVerified,
      });

    logger.info(
      {
        actorUserId: req.user?.id,
        targetUserId,
        previousRole: existing.role,
        newRole: role,
      },
      '[AdminRBAC] User role updated by administrator'
    );

    res.json({ user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid role specified', details: error.issues });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/control/admin/backups/export?projectId=<uuid>
router.get('/backups/export', async (req: AuthRequest, res) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    if (!projectId) {
      return res.status(400).json({ error: 'projectId query parameter is required' });
    }
    const backup = await exportWorkspaceBackup(projectId);
    logger.info(
      { actorUserId: req.user?.id, projectId, checksumSha256: backup.checksumSha256 },
      '[AdminBackup] Workspace snapshot exported'
    );
    res.json(backup);
  } catch (err: any) {
    if (String(err?.message || '').includes('not found')) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(500).json({ error: 'Failed to export workspace backup' });
  }
});

// POST /api/control/admin/backups/verify
router.post('/backups/verify', async (req: AuthRequest, res) => {
  const result = verifyWorkspaceBackupIntegrity(req.body);
  if (!result.valid) {
    return res.status(400).json({ valid: false, reason: result.reason });
  }
  res.json({ valid: true, checksumSha256: req.body.checksumSha256 });
});

export const adminRouter = router;
