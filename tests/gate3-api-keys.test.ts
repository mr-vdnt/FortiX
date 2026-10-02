import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../src/api/index.js';
import { db } from '../src/db/index.js';
import { users, organizations, projects, apiKeys } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
dotenv.config();

const app = express();
app.use(express.json());
setupApiRoutes(app);

describe('Gate 3 - API Key Lifecycle & Cryptography', () => {
  const secret = process.env.JWT_SECRET || 'secret';
  
  const tenant = {
    userId: uuidv4(),
    email: 'tenant_keys@example.com',
    token: '',
    orgId: uuidv4(),
    projId: uuidv4(),
  };

  let createdKeyId: string;
  let rawSecret: string;
  let keyPrefix: string;

  beforeAll(async () => {
    tenant.token = jwt.sign({ id: tenant.userId, email: tenant.email }, secret);

    await db.insert(users).values({ id: tenant.userId, email: tenant.email, passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: tenant.orgId, name: 'Org Keys', ownerId: tenant.userId });
    await db.insert(projects).values({ id: tenant.projId, name: 'Project Keys', orgId: tenant.orgId, environment: 'development' });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, tenant.userId));
  });

  it('Successfully creates an API Key and returns the raw secret exactly once', async () => {
    const res = await request(app).post('/api/control/keys')
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({ projectId: tenant.projId, name: 'Test Key 1' });
    
    expect(res.status).toBe(201);
    expect(res.body.rawKey).toBeDefined();
    expect(res.body.keyPrefix).toBeDefined();
    
    createdKeyId = res.body.id;
    rawSecret = res.body.rawKey;
    keyPrefix = res.body.keyPrefix;
  });

  it('Cryptographically hashes the secret in the database', async () => {
    const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, createdKeyId));
    expect(dbKey).toBeDefined();
    expect(dbKey.secretHash).toBeDefined();
    expect(dbKey.secretHash).not.toEqual(rawSecret);
    
    // Extract the actual secret part from rawKey (fx_env_keyId_secret)
    const secretPart = rawSecret.split('_').pop()!;
    const isValid = await bcrypt.compare(secretPart, dbKey.secretHash);
    expect(isValid).toBe(true);
  });

  it('Does not expose the raw secret on subsequent fetches', async () => {
    const res = await request(app).get(`/api/control/keys?projectId=${tenant.projId}`)
      .set('Authorization', `Bearer ${tenant.token}`);
    
    expect(res.status).toBe(200);
    const fetchedKey = res.body.find((k: any) => k.id === createdKeyId);
    expect(fetchedKey).toBeDefined();
    expect(fetchedKey.rawKey).toBeUndefined(); // Must not be leaked!
    expect(fetchedKey.secretHash).toBeUndefined(); // Internal hash must not be leaked!
  });

  it('Revokes the key by setting revokedAt', async () => {
    const res = await request(app).post(`/api/control/keys/${createdKeyId}/revoke`)
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({ projectId: tenant.projId });
    
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).toBeDefined();

    const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, createdKeyId));
    expect(dbKey.revokedAt).not.toBeNull();
  });
});
