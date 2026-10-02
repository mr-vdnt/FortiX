import os
content = """import { z } from 'zod';
import express from 'express';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const list = await db.select().from(projects).where(eq(projects.userId, userId));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const [newProject] = await db.insert(projects).values({
      id: uuidv4(),
      name,
      userId
    }).returning();
    res.status(201).json(newProject);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Middleware to ensure user owns project before allowing nested operations
export const requireProjectOwnership = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.user!.id;
  let projectId = req.params.projectId || req.body.projectId || req.query.projectId;

  try {
    let project;
    
    if (projectId) {
      const [foundProject] = await db.select().from(projects).where(
        and(eq(projects.id, projectId as string), eq(projects.userId, userId))
      ).limit(1);
      project = foundProject;
    } else {
      const [defaultProject] = await db.select().from(projects).where(eq(projects.userId, userId)).limit(1);
      project = defaultProject;
      if (project) {
         if (req.method === 'GET' || req.method === 'DELETE') req.query.projectId = project.id;
         else req.body.projectId = project.id;
      }
    }

    if (!project) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project or no projects exist' });
    }

    (req as any).project = project;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to verify project ownership' });
  }
};

router.patch('/:projectId', requireProjectOwnership, async (req, res) => {
  const { projectId } = req.params;
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const [updated] = await db.update(projects).set({ name }).where(eq(projects.id, projectId as string)).returning();
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    }
    res.status(500).json({ error: 'Failed to update project' });
  }
});

export const projectsRouter = router;
"""
with open('src/api/projects.ts', 'w') as f:
    f.write(content)
