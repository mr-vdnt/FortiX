import express from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AuthRequest } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const router = express.Router();

router.get('/me', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const [user] = await db.select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const isAdmin = user.role === 'ADMIN';
    const entitlements = {
      advancedExperiments: isAdmin,
      policyVerification: isAdmin,
      advancedAnalytics: isAdmin,
      realtimeTelemetry: isAdmin,
      topology: isAdmin,
      advancedSecurity: isAdmin,
      reportExport: isAdmin
    };
    
    res.json({ ...user, entitlements });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.post('/password', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) return res.status(400).json({ error: 'Invalid current password' });
    
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
    
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.issues });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const accountRouter = router;
