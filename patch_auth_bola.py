import os

content = open('src/api/projects.ts').read()

old_middleware = """export const requireProjectOwnership = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.user!.id;
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    const [project] = await db.select().from(projects).where(
      and(
        eq(projects.id, projectId as string),
        eq(projects.userId, userId)
      )
    ).limit(1);

    if (!project) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    // Pass the validated project context
    (req as any).project = project;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to verify project ownership' });
  }
};"""

new_middleware = """export const requireProjectOwnership = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.user!.id;
  let projectId = req.params.projectId || req.body.projectId || req.query.projectId;

  try {
    let project;
    
    if (projectId) {
      // User explicitly requested a project, verify ownership
      const [foundProject] = await db.select().from(projects).where(
        and(
          eq(projects.id, projectId as string),
          eq(projects.userId, userId)
        )
      ).limit(1);
      project = foundProject;
    } else {
      // Infer the default project for this user (first one)
      const [defaultProject] = await db.select().from(projects).where(eq(projects.userId, userId)).limit(1);
      project = defaultProject;
      
      // If we found a default project, inject it so downstream handlers don't crash expecting it
      if (project) {
         if (req.method === 'GET' || req.method === 'DELETE') req.query.projectId = project.id;
         else req.body.projectId = project.id;
      }
    }

    if (!project) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project or no projects exist' });
    }

    // Pass the validated project context
    (req as any).project = project;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to verify project ownership' });
  }
};"""

content = content.replace(old_middleware, new_middleware)

with open('src/api/projects.ts', 'w') as f:
    f.write(content)

print("requireProjectOwnership patched successfully.")
