import { db } from './index.js';
import { users, projects, apiRoutes, organizations, apiKeys } from './schema.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

async function seed() {
  const userId = uuidv4();
  const orgId = uuidv4();
  const projectId = uuidv4();

  await db.insert(users).values({
    id: userId,
    email: 'admin@fortix.test',
    passwordHash: await bcrypt.hash('password123', 10),
    role: 'ADMIN'
  });

  await db.insert(organizations).values({
    id: orgId,
    name: 'Default Org',
    ownerId: userId
  });

  await db.insert(projects).values({
    id: projectId,
    name: 'Demo Project',
    orgId: orgId
  });

  await db.insert(apiRoutes).values({
    id: uuidv4(),
    projectId,
    pathPattern: '/api/v1/data',
    targetUrl: 'http://localhost:3001/api/v1/data'
  });
  
  const keyId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = await bcrypt.hash(secret, 10);
  const keyPrefix = `fx_live_${keyId}`;

  await db.insert(apiKeys).values({
    id: keyId,
    projectId,
    keyPrefix,
    secretHash,
    name: 'Demo Key'
  });

  console.log('Seed complete!');
  process.exit(0);
}
seed();
