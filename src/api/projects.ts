import { z } from 'zod';
import express from 'express';
import { db } from '../db/index.js';
import { projects, organizations } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Helper to get or create a default organization for a user
async function getDefaultOrg(userId: string) {
  let [org] = await db.select().from(organizations).where(eq(organizations.ownerId, userId)).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({
      id: uuidv4(),
      name: 'Default Organization',
      ownerId: userId
    }).returning();
  }
  return org;
}

router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const org = await getDefaultOrg(userId);
    const list = await db.select().from(projects).where(eq(projects.orgId, org.id));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const { name, environment } = z.object({ 
      name: z.string().min(1),
      environment: z.string().optional().default('development')
    }).parse(req.body);
    
    const org = await getDefaultOrg(userId);
    const [newProject] = await db.insert(projects).values({
      id: uuidv4(),
      name,
      orgId: org.id,
      environment
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
    const org = await getDefaultOrg(userId);
    let project;
    
    if (projectId && projectId !== 'undefined' && projectId !== 'null') {
      const [foundProject] = await db.select().from(projects).where(
        eq(projects.id, projectId as string)
      ).limit(1);
      
      if (foundProject) {
        if (foundProject.orgId !== org.id) {
          return res.status(403).json({ error: 'Forbidden: You do not own this project' });
        }
        project = foundProject;
      }
    }
    
    if (!project) {
      let [defaultProject] = await db.select().from(projects).where(eq(projects.orgId, org.id)).limit(1);
      if (!defaultProject) {
        [defaultProject] = await db.insert(projects).values({
          id: uuidv4(),
          name: 'Default Project',
          orgId: org.id,
          environment: 'development'
        }).returning();
      }
      project = defaultProject;
      if (req.method === 'GET' || req.method === 'DELETE') req.query.projectId = project.id;
      else if (req.body) req.body.projectId = project.id;
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
    const { name, environment } = z.object({ 
      name: z.string().min(1).optional(),
      environment: z.string().optional()
    }).parse(req.body);
    
    const updates: any = {};
    if (name) updates.name = name;
    if (environment) updates.environment = environment;
    
    const [updated] = await db.update(projects).set(updates).where(eq(projects.id, projectId as string)).returning();
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    }
    res.status(500).json({ error: 'Failed to update project' });
  }
});

export const projectsRouter = router;
