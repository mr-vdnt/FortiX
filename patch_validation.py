import os
import re

# 1. Patch policies.ts
policies = open('src/api/policies.ts').read()
policies_old = """  const { projectId, routeId, type, config } = req.body;
  
  // Basic validation
  if (!projectId || !type || !config) return res.status(400).json({ error: 'Missing fields' });"""

policies_new = """  const policySchema = z.object({
    projectId: z.string().min(1),
    routeId: z.string().optional().nullable(),
    type: z.string().min(1),
    config: z.any() // JSONB
  });
  
  try {
    const { projectId, routeId, type, config } = policySchema.parse(req.body);"""

policies_catch = """  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    res.status(500).json({ error: 'Failed to create policy' });
  }"""

# Inject try/catch for policies
policies = policies.replace(policies_old, policies_new)
policies = policies.replace("res.status(201).json(newPolicy);\n});", f"res.status(201).json(newPolicy);\n{policies_catch}\n}});")
with open('src/api/policies.ts', 'w') as f:
    f.write(policies)


# 2. Patch projects.ts
projects = open('src/api/projects.ts').read()
projects = "import { z } from 'zod';\n" + projects

projects_old = """  const userId = req.user!.id;
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });"""

projects_new = """  const userId = req.user!.id;
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);"""

projects_catch = """  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', issues: error.issues });
    res.status(500).json({ error: 'Failed to create project' });
  }"""

projects = projects.replace(projects_old, projects_new)
projects = projects.replace("res.status(201).json(newProject);\n  } catch (error) {", f"res.status(201).json(newProject);\n{projects_catch}\n  /*")
projects = projects.replace("res.status(500).json({ error: 'Failed to create project' });\n  }", "*/")

with open('src/api/projects.ts', 'w') as f:
    f.write(projects)

print("Validation patched.")
