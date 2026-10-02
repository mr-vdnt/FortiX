import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../src/api/index.js';
import { db } from '../src/db/index.js';
import { users, organizations, projects, apiRoutes } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());
setupApiRoutes(app);

describe('Gate 1 - Tenant Isolation', () => {
  const userA_id = uuidv4();
  const userB_id = uuidv4();
  const orgA_id = uuidv4();
  const orgB_id = uuidv4();
  const projA_id = uuidv4();
  const projB_id = uuidv4();

  const tokenA = jwt.sign({ id: userA_id, email: 'usera@example.com' }, process.env.JWT_SECRET || 'secret');
  const tokenB = jwt.sign({ id: userB_id, email: 'userb@example.com' }, process.env.JWT_SECRET || 'secret');

  beforeAll(async () => {
    // Set up user A and project A
    await db.insert(users).values({ id: userA_id, email: 'usera@example.com', passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: orgA_id, name: 'Org A', ownerId: userA_id });
    await db.insert(projects).values({ id: projA_id, name: 'Project A', orgId: orgA_id, environment: 'development' });

    // Set up user B and project B
    await db.insert(users).values({ id: userB_id, email: 'userb@example.com', passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: orgB_id, name: 'Org B', ownerId: userB_id });
    await db.insert(projects).values({ id: projB_id, name: 'Project B', orgId: orgB_id, environment: 'development' });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userA_id));
    await db.delete(users).where(eq(users.id, userB_id));
  });

  it('Allows User A to create an API Key in Project A', async () => {
    const res = await request(app)
      .post('/api/control/keys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ projectId: projA_id, name: 'Test Key A' });
    expect(res.status).toBe(201);
    expect(res.body.keyPrefix).toBeDefined();
  });

  it('Denies User A from creating an API Key in Project B', async () => {
    const res = await request(app)
      .post('/api/control/keys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ projectId: projB_id, name: 'Hacked Key' });
    expect(res.status).toBe(403);
  });

  it('Denies User B from fetching User A\'s API Keys', async () => {
    const res = await request(app)
      .get(`/api/control/keys?projectId=${projA_id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it('Allows User A to fetch their own projects', async () => {
    const res = await request(app)
      .get(`/api/control/projects`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === projA_id)).toBe(true);
    expect(res.body.some((p: any) => p.id === projB_id)).toBe(false);
  });

  it('Returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .get(`/api/control/projects`);
    expect(res.status).toBe(401);
  });
});
