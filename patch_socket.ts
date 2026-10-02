import fs from 'fs';

let content = fs.readFileSync('src/socket.ts', 'utf8');

const oldCheck = `        // Verify ownership
        const [project] = await db.select().from(projects).where(
          and(eq(projects.id, projectId), eq(projects.userId, socket.data.user.id))
        ).limit(1);`;
        
const newCheck = `        // Verify ownership
        const [project] = await db.select({ id: projects.id }).from(projects)
          .leftJoin(import('./db/schema.js').then(s => s.organizations), eq(projects.orgId, (await import('./db/schema.js')).organizations.id))
          .where(
            and(eq(projects.id, projectId), eq((await import('./db/schema.js')).organizations.ownerId, socket.data.user.id))
          ).limit(1);`;

content = content.replace(oldCheck, newCheck);
// Better to just rewrite the file cleanly.
