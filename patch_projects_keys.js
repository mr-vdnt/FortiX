const fs = require('fs');

let projectsContent = fs.readFileSync('src/api/projects.ts', 'utf8');
const projectsPatch = `
router.patch('/:projectId', requireProjectOwnership, async (req, res) => {
  const { projectId } = req.params;
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });
  try {
    const [updated] = await db.update(projects).set({ name }).where(eq(projects.id, projectId as string)).returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});
export const projectsRouter = router;
`;
projectsContent = projectsContent.replace('export const projectsRouter = router;', projectsPatch);
fs.writeFileSync('src/api/projects.ts', projectsContent);

let keysContent = fs.readFileSync('src/api/keys.ts', 'utf8');
const keysPatch = `
router.post('/revoke-all', requireProjectOwnership, async (req, res) => {
  const projectId = req.body.projectId;
  try {
    await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.projectId, projectId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke keys' });
  }
});
export const apiKeysRouter = router;
`;
keysContent = keysContent.replace('export const apiKeysRouter = router;', keysPatch);
fs.writeFileSync('src/api/keys.ts', keysContent);
