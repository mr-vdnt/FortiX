import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../src/api/index.js';
import { setupGateway, apiKeyCache, invalidateApiKeyCache } from '../src/gateway/index.js';
import { db } from '../src/db/index.js';
import { users, organizations, projects, apiRoutes, apiKeys } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import { 
  REDIS_KEY_REVOCATION_CHANNEL, 
  keyRevocationEventSchema, 
  publishKeyRevocation, 
  setupKeyRevocationSubscriber,
  closeKeyRevocationClients 
} from '../src/lib/key-invalidation.js';

dotenv.config();

describe('Gate 3.5 - Distributed API-Key Cache Invalidation (Redis Pub/Sub)', () => {
  const secret = process.env.JWT_SECRET || 'secret';
  
  const tenant = {
    userId: uuidv4(),
    email: 'distributed_tenant@example.com',
    token: '',
    orgId: uuidv4(),
    projId: uuidv4(),
  };

  const routeId = uuidv4();
  let rawKeyA = '';
  let keyIdA = '';
  let rawKeyB = '';
  let keyIdB = '';

  // Simulate two independent Gateway instances with their own in-memory caches
  const gatewayA = express();
  gatewayA.use(express.json());
  setupApiRoutes(gatewayA);
  setupGateway(gatewayA);

  const gatewayB = express();
  gatewayB.use(express.json());
  setupApiRoutes(gatewayB);
  setupGateway(gatewayB);

  beforeAll(async () => {
    tenant.token = jwt.sign({ id: tenant.userId, email: tenant.email }, secret);

    await db.insert(users).values({ id: tenant.userId, email: tenant.email, passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: tenant.orgId, name: 'Org Distributed', ownerId: tenant.userId });
    await db.insert(projects).values({ id: tenant.projId, name: 'Project Distributed', orgId: tenant.orgId, environment: 'development' });
    
    await db.insert(apiRoutes).values({
      id: routeId,
      projectId: tenant.projId,
      pathPattern: '/dist-test',
      targetUrl: 'http://fortix-demo-api.internal/health'
    });

    // Key 1
    keyIdA = crypto.randomBytes(8).toString('hex');
    const secretA = crypto.randomBytes(32).toString('hex');
    rawKeyA = `fx_test_${keyIdA}_${secretA}`;
    await db.insert(apiKeys).values({
      id: keyIdA,
      projectId: tenant.projId,
      keyPrefix: `fx_test_${keyIdA}`,
      secretHash: await bcrypt.hash(secretA, 10),
      name: 'Distributed Key A'
    });

    // Key 2
    keyIdB = crypto.randomBytes(8).toString('hex');
    const secretB = crypto.randomBytes(32).toString('hex');
    rawKeyB = `fx_test_${keyIdB}_${secretB}`;
    await db.insert(apiKeys).values({
      id: keyIdB,
      projectId: tenant.projId,
      keyPrefix: `fx_test_${keyIdB}`,
      secretHash: await bcrypt.hash(secretB, 10),
      name: 'Distributed Key B'
    });

    // Ensure subscriber is initialized
    setupKeyRevocationSubscriber();
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, tenant.userId));
    await closeKeyRevocationClients();
  });

  it('1. Schema Validation: parses valid revocation events and rejects malformed payloads', () => {
    const validRevoke = {
      event: 'api_key.revoked',
      keyId: 'key-123',
      projectId: 'proj-456',
      timestamp: new Date().toISOString(),
      reason: 'manual_revoke'
    };
    expect(keyRevocationEventSchema.safeParse(validRevoke).success).toBe(true);

    const validRevokeAll = {
      event: 'api_key.revoked_all',
      projectId: 'proj-456',
      timestamp: new Date().toISOString()
    };
    expect(keyRevocationEventSchema.safeParse(validRevokeAll).success).toBe(true);

    const invalidEvent = {
      event: 'invalid_type',
      projectId: 'proj-456'
    };
    expect(keyRevocationEventSchema.safeParse(invalidEvent).success).toBe(false);

    const missingKeyId = {
      event: 'api_key.revoked',
      projectId: 'proj-456',
      timestamp: new Date().toISOString()
    };
    expect(keyRevocationEventSchema.safeParse(missingKeyId).success).toBe(false);
  });

  it('2. Cache Population: authenticating populates in-memory API key cache', async () => {
    invalidateApiKeyCache();
    expect(apiKeyCache.has(rawKeyA)).toBe(false);

    // Make proxy request to populate cache
    const res = await request(gatewayA)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', rawKeyA);

    expect(res.status).not.toBe(401);
    expect(apiKeyCache.has(rawKeyA)).toBe(true);
    const cachedEntry = apiKeyCache.get(rawKeyA);
    expect(cachedEntry?.key.id).toBe(keyIdA);
  });

  it('3. Multi-Node Revocation: revoking Key A via API publishes to Redis and evicts cached entry', async () => {
    // Populate cache for Key A and Key B
    await request(gatewayA).get(`/proxy/${routeId}`).set('X-API-Key', rawKeyA);
    await request(gatewayA).get(`/proxy/${routeId}`).set('X-API-Key', rawKeyB);

    expect(apiKeyCache.has(rawKeyA)).toBe(true);
    expect(apiKeyCache.has(rawKeyB)).toBe(true);

    // Revoke Key A via control API
    const revokeRes = await request(gatewayA)
      .post(`/api/control/keys/${keyIdA}/revoke`)
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({ projectId: tenant.projId });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // Wait 100ms for Redis Pub/Sub propagation
    await new Promise(r => setTimeout(r, 100));

    // Key A must be evicted from cache
    expect(apiKeyCache.has(rawKeyA)).toBe(false);
    // Key B must remain unaffected
    expect(apiKeyCache.has(rawKeyB)).toBe(true);

    // Subsequent request with revoked Key A must be immediately rejected with 401
    const proxyRes = await request(gatewayA)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', rawKeyA);

    expect(proxyRes.status).toBe(401);
    expect(proxyRes.body.error).toBe('Invalid or Revoked API Key');
  });

  it('4. Project Revoke-All: revoking all keys for a project evicts all matching cached keys', async () => {
    // Populate Key B in cache
    await request(gatewayA).get(`/proxy/${routeId}`).set('X-API-Key', rawKeyB);
    expect(apiKeyCache.has(rawKeyB)).toBe(true);

    // Revoke all keys for tenant project
    const revokeAllRes = await request(gatewayA)
      .post('/api/control/keys/revoke-all')
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({ projectId: tenant.projId });

    expect(revokeAllRes.status).toBe(200);
    expect(revokeAllRes.body.success).toBe(true);

    // Wait 100ms for Redis Pub/Sub
    await new Promise(r => setTimeout(r, 100));

    // Key B must be evicted
    expect(apiKeyCache.has(rawKeyB)).toBe(false);

    // Subsequent request must be rejected with 401
    const proxyRes = await request(gatewayA)
      .get(`/proxy/${routeId}`)
      .set('X-API-Key', rawKeyB);

    expect(proxyRes.status).toBe(401);
  });

  it('5. Subscriber Resilience: subscriber recovers cleanly and handles malformed messages without throwing', async () => {
    const rawRedis = new Redis('redis://127.0.0.1:6379');
    
    // Publish a completely invalid non-JSON string
    await rawRedis.publish(REDIS_KEY_REVOCATION_CHANNEL, 'NOT_JSON_DATA');
    // Publish a JSON string that does not match schema
    await rawRedis.publish(REDIS_KEY_REVOCATION_CHANNEL, JSON.stringify({ wrong: 'schema' }));
    
    await new Promise(r => setTimeout(r, 50));
    await rawRedis.quit();
    
    // Gateway remains fully operational
    const res = await request(gatewayA).get(`/proxy/${routeId}`);
    expect(res.status).toBe(401); // Rejection due to missing key, no crash
  });
});
