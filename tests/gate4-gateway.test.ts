import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../src/api/index.js';
import { setupGateway } from '../src/gateway/index.js';
import { db } from '../src/db/index.js';
import { users, organizations, projects, apiRoutes, apiKeys } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());
setupApiRoutes(app);
setupGateway(app);

describe('Gate 4 - Gateway Enforcement', () => {
  const secret = process.env.JWT_SECRET || 'secret';
  
  const tenant = {
    userId: uuidv4(),
    email: 'gateway_tenant@example.com',
    token: '',
    orgId: uuidv4(),
    projId: uuidv4(),
  };

  const routeId = uuidv4();
  
  let rawValidKey = '';
  let rawRevokedKey = '';

  beforeAll(async () => {
    tenant.token = jwt.sign({ id: tenant.userId, email: tenant.email }, secret);

    await db.insert(users).values({ id: tenant.userId, email: tenant.email, passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: tenant.orgId, name: 'Org GW', ownerId: tenant.userId });
    await db.insert(projects).values({ id: tenant.projId, name: 'Project GW', orgId: tenant.orgId, environment: 'development' });
    
    // Create a route for testing proxy
    await db.insert(apiRoutes).values({
      id: routeId,
      projectId: tenant.projId,
      pathPattern: '/test-gw',
      targetUrl: 'http://fortix-demo-api.internal/health' // Handled by bypass in gateway for demo
    });

    // Valid Key
    const keyId1 = crypto.randomBytes(8).toString('hex');
    const secret1 = crypto.randomBytes(32).toString('hex');
    rawValidKey = `fx_test_${keyId1}_${secret1}`;
    await db.insert(apiKeys).values({
      id: keyId1,
      projectId: tenant.projId,
      keyPrefix: `fx_test_${keyId1}`,
      secretHash: await bcrypt.hash(secret1, 10),
      name: 'Valid Key'
    });

    // Revoked Key
    const keyId2 = crypto.randomBytes(8).toString('hex');
    const secret2 = crypto.randomBytes(32).toString('hex');
    rawRevokedKey = `fx_test_${keyId2}_${secret2}`;
    await db.insert(apiKeys).values({
      id: keyId2,
      projectId: tenant.projId,
      keyPrefix: `fx_test_${keyId2}`,
      secretHash: await bcrypt.hash(secret2, 10),
      name: 'Revoked Key',
      revokedAt: new Date()
    });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, tenant.userId));
  });

  it('1. Rejects proxy request missing API Key', async () => {
    const res = await request(app).get(`/proxy/${routeId}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing API Key');
  });

  it('2. Rejects proxy request with malformed API Key', async () => {
    const res = await request(app)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', 'invalid-format-key');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Malformed API Key');
  });

  it('3. Rejects proxy request with revoked API Key', async () => {
    const res = await request(app)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', rawRevokedKey);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or Revoked API Key');
  });

  it('4. Rejects proxy request with fake/invalid API Key', async () => {
    const fakeKey = rawValidKey.slice(0, -5) + 'fake1';
    const res = await request(app)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', fakeKey);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or Revoked API Key');
  });

  it('5. Allows proxy request with valid API Key', async () => {
    // Note: since this is a unit test in CI, the target "http://127.0.0.1:3001" might not exist or might respond 404/502. 
    // What matters is that the gateway auth passed and we tried to proxy (status != 401).
    // The gateway returns 502/500 if the backend is down, but that still proves auth succeeded.
    const res = await request(app)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', rawValidKey);
      
    // Auth passed!
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
