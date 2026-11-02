import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { setupApiRoutes } from '../../src/api/index.js';
import { setupGateway, invalidateExpCache } from '../../src/gateway/index.js';
import { isSafeTarget } from '../../src/gateway/ssrf.js';
import { db } from '../../src/db/index.js';
import {
  experiments,
  metricLogs,
  organizations,
  projects,
  securityEvents,
  securityPolicies,
  users,
  verifications,
} from '../../src/db/schema.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../src/lib/jwt-security.js';
import { flushTelemetryBarrier } from '../../src/lib/telemetry.js';
import { runExperimentLogic } from '../../src/experiments/worker.js';

function issueTestJwt(payload: { id: string; email: string; role: string }): string {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });
}

describe('FTX-API-STUDIO-001: Self-Service API Studio, Protected Gateway CRUD, Security & Verification', () => {
  let app: express.Express;
  let server: http.Server;
  let boundPort: number;
  const originalPortEnv = process.env.PORT;

  let tenantAToken: string;
  let tenantAViewerToken: string;
  let tenantAProjectId: string;
  let viewerOwnedProjectId: string;

  let tenantBToken: string;
  let tenantBProjectId: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json({ limit: '2mb' }));
    setupApiRoutes(app);
    setupGateway(app);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    boundPort = typeof addr === 'object' && addr ? addr.port : 3000;
    process.env.PORT = String(boundPort);

    const passwordHash = await bcrypt.hash('StudioPass123!', 8);

    // Provision Tenant A (DEVELOPER + VIEWER)
    const userAId = uuidv4();
    const viewerAId = uuidv4();
    const orgAId = uuidv4();
    tenantAProjectId = uuidv4();

    await db.insert(users).values([
      {
        id: userAId,
        email: `studio-dev-a-${Date.now()}@fortix.test`,
        passwordHash,
        role: 'DEVELOPER',
        emailVerified: true,
      },
      {
        id: viewerAId,
        email: `studio-viewer-a-${Date.now()}@fortix.test`,
        passwordHash,
        role: 'VIEWER',
        emailVerified: true,
      },
    ]);
    await db.insert(organizations).values({
      id: orgAId,
      name: 'Studio Tenant A Org',
      ownerId: userAId,
    });
    await db.insert(projects).values({
      id: tenantAProjectId,
      orgId: orgAId,
      name: 'Studio Tenant A Project',
      environment: 'development',
    });

    const viewerOrgId = uuidv4();
    viewerOwnedProjectId = uuidv4();
    await db.insert(organizations).values({
      id: viewerOrgId,
      name: 'Viewer ReadOnly Org',
      ownerId: viewerAId,
    });
    await db.insert(projects).values({
      id: viewerOwnedProjectId,
      orgId: viewerOrgId,
      name: 'Viewer ReadOnly Project',
      environment: 'development',
    });

    tenantAToken = issueTestJwt({ id: userAId, email: 'dev-a@fortix.test', role: 'DEVELOPER' });
    tenantAViewerToken = issueTestJwt({ id: viewerAId, email: 'viewer-a@fortix.test', role: 'VIEWER' });

    // Provision Tenant B (isolated organization & project)
    const userBId = uuidv4();
    const orgBId = uuidv4();
    tenantBProjectId = uuidv4();

    await db.insert(users).values({
      id: userBId,
      email: `studio-dev-b-${Date.now()}@fortix.test`,
      passwordHash,
      role: 'DEVELOPER',
      emailVerified: true,
    });
    await db.insert(organizations).values({
      id: orgBId,
      name: 'Studio Tenant B Org',
      ownerId: userBId,
    });
    await db.insert(projects).values({
      id: tenantBProjectId,
      orgId: orgBId,
      name: 'Studio Tenant B Project',
      environment: 'development',
    });

    tenantBToken = issueTestJwt({ id: userBId, email: 'dev-b@fortix.test', role: 'DEVELOPER' });
  });

  afterAll(async () => {
    if (originalPortEnv === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPortEnv;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. provisions Products API with 100 canonical INR records across 24 categories (94 active, 6 inactive)', async () => {
    const createRes = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Store Products API',
        description: 'Canonical 100-product security playground',
        basePath: '/api/store',
        version: 'v1',
        template: 'products_100',
        initialPolicy: {
          rateLimitRpm: 120,
          enableWaf: true,
          enableSsrf: true,
        },
        issueApiKey: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Store Products API');
    expect(createRes.body.basePath).toBe('/api/store');
    expect(createRes.body.version).toBe('v1');
    expect(createRes.body.routeId).toBeTruthy();
    expect(createRes.body.gatewayBaseUrl).toBe(`/proxy/${createRes.body.routeId}`);
    expect(createRes.body.totalRecords).toBe(100);
    expect(createRes.body.resources).toHaveLength(1);
    expect(createRes.body.resources[0].slug).toBe('products');
    expect(createRes.body.resources[0].recordCount).toBe(100);
    expect(createRes.body.issuedApiKey?.rawKey).toMatch(/^fx_test_/);

    const routeId = createRes.body.routeId as string;
    const rawKey = createRes.body.issuedApiKey.rawKey as string;

    // Fetch all 100 records through the protected /proxy/:routeId gateway
    const listRes = await request(app)
      .get(`/proxy/${routeId}/api/store/products?limit=100&offset=0`)
      .set('x-api-key', rawKey);

    expect(listRes.status).toBe(200);
    expect(listRes.body.pagination).toEqual({
      total: 100,
      limit: 100,
      offset: 0,
      hasMore: false,
    });
    expect(listRes.body.items).toHaveLength(100);

    const ids = new Set(listRes.body.items.map((p: any) => p.id));
    const skus = new Set(listRes.body.items.map((p: any) => p.sku));
    const categories = new Set(listRes.body.items.map((p: any) => p.category));
    const activeCount = listRes.body.items.filter((p: any) => p.status === 'active').length;
    const inactiveCount = listRes.body.items.filter((p: any) => p.status === 'inactive').length;

    expect(ids.size).toBe(100);
    expect(skus.size).toBe(100);
    expect(categories.size).toBe(24);
    expect(activeCount).toBe(94);
    expect(inactiveCount).toBe(6);
    expect(listRes.body.items[0]).toMatchObject({
      id: 'prod_0001',
      sku: 'SKU-ELE-001',
      name: 'Wireless Mouse',
      category: 'Electronics',
      price: 799,
      stock: 84,
      status: 'active',
    });
    expect(listRes.body.items[99]).toMatchObject({
      id: 'prod_0100',
      sku: 'FTX-0100',
      name: 'Developer IDE License',
      category: 'Software & Licenses',
      price: 14049,
      stock: 90,
      status: 'active',
    });
  });

  it('2. executes full CRUD (GET, GET/:id, POST, concurrent PATCH, DELETE) through FortiX Gateway', async () => {
    const createRes = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'CRUD Store API',
        basePath: '/api/crud-store',
        version: 'v1',
        template: 'products_100',
        initialPolicy: { rateLimitRpm: 500, enableWaf: true, enableSsrf: true },
        issueApiKey: true,
      });

    expect(createRes.status).toBe(201);
    const routeId = createRes.body.routeId as string;
    const rawKey = createRes.body.issuedApiKey.rawKey as string;

    // Filtered GET (category + search)
    const cyberRes = await request(app)
      .get(`/proxy/${routeId}/products?category=Cybersecurity&q=FIDO2`)
      .set('x-api-key', rawKey);
    expect(cyberRes.status).toBe(200);
    expect(cyberRes.body.items).toHaveLength(1);
    expect(cyberRes.body.items[0].id).toBe('prod_0035');

    // GET single record & 404 on missing record
    const singleRes = await request(app)
      .get(`/proxy/${routeId}/api/crud-store/products/prod_0007`)
      .set('x-api-key', rawKey);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.name).toBe('27-inch IPS Monitor');

    const missingRes = await request(app)
      .get(`/proxy/${routeId}/api/crud-store/products/prod_9999`)
      .set('x-api-key', rawKey);
    expect(missingRes.status).toBe(404);

    // POST new product -> 201 Created with auto-allocated prod_0101
    const postRes = await request(app)
      .post(`/proxy/${routeId}/api/crud-store/products`)
      .set('x-api-key', rawKey)
      .send({
        sku: 'FTX-0101',
        name: 'Hardware HSM Appliance',
        description: 'FIPS-validated cryptographic key module.',
        category: 'Cybersecurity',
        price: 24999.5,
        stock: 12,
        status: 'active',
      });
    expect(postRes.status).toBe(201);
    expect(postRes.body.id).toBe('prod_0101');
    expect(postRes.body.price).toBe(24999.5);

    // Concurrent PATCH updates on distinct fields must both succeed without lost updates
    const [patchPrice, patchStock] = await Promise.all([
      request(app)
        .patch(`/proxy/${routeId}/api/crud-store/products/prod_0101`)
        .set('x-api-key', rawKey)
        .send({ price: 22500 }),
      request(app)
        .patch(`/proxy/${routeId}/api/crud-store/products/prod_0101`)
        .set('x-api-key', rawKey)
        .send({ stock: 30 }),
    ]);
    expect(patchPrice.status).toBe(200);
    expect(patchStock.status).toBe(200);

    const verifyMerged = await request(app)
      .get(`/proxy/${routeId}/api/crud-store/products/prod_0101`)
      .set('x-api-key', rawKey);
    expect(verifyMerged.status).toBe(200);
    expect(verifyMerged.body.price).toBe(22500);
    expect(verifyMerged.body.stock).toBe(30);
    expect(verifyMerged.body.sku).toBe('FTX-0101');

    // DELETE record -> 200 and subsequent GET -> 404
    const delRes = await request(app)
      .delete(`/proxy/${routeId}/api/crud-store/products/prod_0101`)
      .set('x-api-key', rawKey);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ deleted: true, id: 'prod_0101' });

    const afterDelRes = await request(app)
      .get(`/proxy/${routeId}/api/crud-store/products/prod_0101`)
      .set('x-api-key', rawKey);
    expect(afterDelRes.status).toBe(404);
  });

  it('3. enforces gateway API-key authentication, key revocation, control-plane JWT, and RBAC', async () => {
    const listApis = await request(app)
      .get(`/api/control/studio/apis?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    expect(listApis.status).toBe(200);
    const targetApi = listApis.body[0];
    const routeId = targetApi.routeId as string;

    // Unauthenticated gateway call -> 401
    const noKeyRes = await request(app).get(`/proxy/${routeId}/products`);
    expect(noKeyRes.status).toBe(401);

    // Invalid API key -> 401 + INVALID_API_KEY security event
    const badKeyRes = await request(app)
      .get(`/proxy/${routeId}/products`)
      .set('x-api-key', 'fx_test_deadbeefdeadbeef_invalidsecretvalue');
    expect(badKeyRes.status).toBe(401);

    // Issue key, verify 200, revoke key, verify immediate 401
    const keyRes = await request(app)
      .post('/api/control/keys')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ projectId: tenantAProjectId, name: 'Revocation Test Key' });
    expect(keyRes.status).toBe(201);
    const { id: keyId, rawKey } = keyRes.body;

    const okBeforeRevoke = await request(app)
      .get(`/proxy/${routeId}/products?limit=2`)
      .set('x-api-key', rawKey);
    expect(okBeforeRevoke.status).toBe(200);

    const revokeRes = await request(app)
      .post(`/api/control/keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ projectId: tenantAProjectId });
    expect(revokeRes.status).toBe(200);

    const blockedAfterRevoke = await request(app)
      .get(`/proxy/${routeId}/products?limit=2`)
      .set('x-api-key', rawKey);
    expect(blockedAfterRevoke.status).toBe(401);

    // Control-plane unauthenticated -> 401
    const unauthControl = await request(app).get(`/api/control/studio/apis?projectId=${tenantAProjectId}`);
    expect(unauthControl.status).toBe(401);

    // VIEWER can read their own project (200) but cannot create Studio APIs (403 RBAC)
    const viewerReadOwn = await request(app)
      .get(`/api/control/studio/apis?projectId=${viewerOwnedProjectId}`)
      .set('Authorization', `Bearer ${tenantAViewerToken}`);
    expect(viewerReadOwn.status).toBe(200);

    const viewerWriteOwn = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAViewerToken}`)
      .send({
        projectId: viewerOwnedProjectId,
        name: 'Forbidden Viewer API',
        basePath: '/api/viewer',
      });
    expect(viewerWriteOwn.status).toBe(403);
  });

  it('4. enforces strict cross-tenant isolation and blocks cross-project Studio target spoofing & SSRF', async () => {
    const listA = await request(app)
      .get(`/api/control/studio/apis?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    const apiA = listA.body[0];

    // Tenant B cannot list, inspect, export OpenAPI, or delete Tenant A's Studio API
    const crossList = await request(app)
      .get(`/api/control/studio/apis?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(crossList.status).toBe(403);

    const crossOpenApi = await request(app)
      .get(`/api/control/studio/apis/${apiA.id}/openapi?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(crossOpenApi.status).toBe(403);

    const crossDelete = await request(app)
      .delete(`/api/control/studio/apis/${apiA.id}?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(crossDelete.status).toBe(403);

    // Tenant B cannot register a gateway route pointing at Tenant A's internal Studio target
    const spoofRoute = await request(app)
      .post('/api/control/routes')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({
        projectId: tenantBProjectId,
        pathPattern: '/api/spoof',
        targetUrl: `http://fortix-studio.internal/studio/${apiA.id}`,
      });
    expect(spoofRoute.status).toBe(403);

    // Tenant B API key cannot authenticate against Tenant A's routeId
    const keyBRes = await request(app)
      .post('/api/control/keys')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({ projectId: tenantBProjectId, name: 'Tenant B Key' });
    const keyB = keyBRes.body.rawKey;

    const crossProxy = await request(app)
      .get(`/proxy/${apiA.routeId}/products`)
      .set('x-api-key', keyB);
    expect(crossProxy.status).toBe(401);

    // SSRF guard rejects non-canonical internal URLs or custom ports on fortix-studio.internal
    expect(isSafeTarget('http://fortix-studio.internal:8080/studio/12345678')).toBe(false);
    expect(isSafeTarget('http://fortix-studio.internal/admin')).toBe(false);
    expect(isSafeTarget('http://other-service.internal/studio/12345678')).toBe(false);
    expect(isSafeTarget(`http://fortix-studio.internal/studio/${apiA.id}`)).toBe(true);
  });

  it('5. rejects path/slug collisions, reserved slugs, schema violations, duplicate SKUs, and >64KB payloads', async () => {
    // Duplicate (basePath, version) collision -> 409
    const dupApi = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Duplicate Store Path',
        basePath: '/api/store',
        version: 'v1',
      });
    expect(dupApi.status).toBe(409);

    // Invalid path traversal basePath -> 400
    const badPathApi = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Bad Path API',
        basePath: '/api/../admin',
        version: 'v1',
      });
    expect(badPathApi.status).toBe(400);

    // Create dedicated API for validation tests
    const valApiRes = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Validation Lab API',
        basePath: '/api/validation',
        version: 'v1',
        template: 'products_100',
        initialPolicy: { rateLimitRpm: 500, enableWaf: true, enableSsrf: true },
        issueApiKey: true,
      });
    expect(valApiRes.status).toBe(201);
    const apiId = valApiRes.body.id as string;
    const routeId = valApiRes.body.routeId as string;
    const rawKey = valApiRes.body.issuedApiKey.rawKey as string;

    // Reserved resource slug ('health') -> 400
    const reservedSlugRes = await request(app)
      .post(`/api/control/studio/apis/${apiId}/resources`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'health',
        slug: 'health',
        fields: [{ name: 'title', type: 'string', required: true }],
      });
    expect(reservedSlugRes.status).toBe(400);

    // Duplicate resource slug ('products') -> 409
    const dupSlugRes = await request(app)
      .post(`/api/control/studio/apis/${apiId}/resources`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Products Copy',
        slug: 'products',
        fields: [{ name: 'title', type: 'string', required: true }],
      });
    expect(dupSlugRes.status).toBe(409);

    // Schema violation: negative price & non-integer stock -> 422
    const invalidFieldsRes = await request(app)
      .post(`/proxy/${routeId}/products`)
      .set('x-api-key', rawKey)
      .send({
        sku: 'FTX-BAD-01',
        name: 'Broken Item',
        category: 'Electronics',
        price: -50,
        stock: 4.5,
        status: 'active',
      });
    expect(invalidFieldsRes.status).toBe(422);
    expect(invalidFieldsRes.body.issues.length).toBeGreaterThanOrEqual(2);

    // Duplicate unique SKU ('SKU-ELE-001') -> 409
    const dupSkuRes = await request(app)
      .post(`/proxy/${routeId}/products`)
      .set('x-api-key', rawKey)
      .send({
        sku: 'SKU-ELE-001',
        name: 'Cloned Mouse',
        category: 'Electronics',
        price: 799,
        stock: 10,
        status: 'active',
      });
    expect(dupSkuRes.status).toBe(409);

    // Invalid pagination bounds -> 400
    const badPageRes = await request(app)
      .get(`/proxy/${routeId}/products?limit=999`)
      .set('x-api-key', rawKey);
    expect(badPageRes.status).toBe(400);

    // Oversized >64KB payload -> 413
    const hugeDescription = 'X'.repeat(70_000);
    const oversizedRes = await request(app)
      .post(`/proxy/${routeId}/products`)
      .set('x-api-key', rawKey)
      .send({
        sku: 'FTX-HUGE-01',
        name: 'Oversized Item',
        description: hugeDescription,
        category: 'Electronics',
        price: 999,
        stock: 1,
        status: 'active',
      });
    expect(oversizedRes.status).toBe(413);
  });

  it('6. enforces WAF (SQLi/XSS), parameter SSRF blocking, token-bucket rate limiting, and real metric_logs telemetry', async () => {
    const secApiRes = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Security Gate API',
        basePath: '/api/sec-gate',
        version: 'v1',
        template: 'products_100',
        initialPolicy: {
          rateLimitRpm: 6,
          enableWaf: true,
          enableSsrf: true,
        },
        issueApiKey: true,
      });
    expect(secApiRes.status).toBe(201);
    const routeId = secApiRes.body.routeId as string;
    const rawKey = secApiRes.body.issuedApiKey.rawKey as string;

    // SQLi in query parameter -> 403 Blocked by WAF
    const sqliRes = await request(app)
      .get(`/proxy/${routeId}/products?q=${encodeURIComponent("' OR 1=1 --")}`)
      .set('x-api-key', rawKey);
    expect(sqliRes.status).toBe(403);

    // Parameter SSRF attempt -> 403 Blocked
    const ssrfParamRes = await request(app)
      .get(`/proxy/${routeId}/products?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`)
      .set('x-api-key', rawKey);
    expect(ssrfParamRes.status).toBe(403);

    // Internal studio host smuggled in query parameter -> 403 Blocked
    const internalParamRes = await request(app)
      .get(`/proxy/${routeId}/products?callback=${encodeURIComponent(`http://fortix-studio.internal/studio/${secApiRes.body.id}`)}`)
      .set('x-api-key', rawKey);
    expect(internalParamRes.status).toBe(403);

    // Rate Limit Burst: 6 RPM policy -> send 10 requests -> first 6 return 200, remaining 4 return 429
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .get(`/proxy/${routeId}/products?limit=2`)
        .set('x-api-key', rawKey);
      statuses.push(r.status);
    }

    expect(statuses.filter((s) => s === 200).length).toBe(6);
    expect(statuses.filter((s) => s === 429).length).toBe(4);

    // Flush telemetry barrier and verify real metric_logs & security_events were persisted
    await flushTelemetryBarrier();
    const metrics = await db.select().from(metricLogs).where(eq(metricLogs.routeId, routeId));
    const events = await db.select().from(securityEvents).where(eq(securityEvents.routeId, routeId));

    expect(metrics.some((m) => m.statusCode === 200)).toBe(true);
    expect(metrics.some((m) => m.statusCode === 429)).toBe(true);
    expect(metrics.some((m) => m.statusCode === 403)).toBe(true);
    expect(events.some((e) => e.threatType === 'RATE_LIMIT_EXCEEDED')).toBe(true);
    expect(events.some((e) => e.threatType === 'SSRF_ATTEMPT')).toBe(true);
  });

  it('7. executes real traffic_burst & latency experiments against a Studio API and produces truthful PASS verification evidence', async () => {
    const expApiRes = await request(app)
      .post('/api/control/studio/apis')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        projectId: tenantAProjectId,
        name: 'Verification Evidence Store API',
        basePath: '/api/verify-store',
        version: 'v1',
        template: 'products_100',
        initialPolicy: {
          rateLimitRpm: 12,
          enableWaf: true,
          enableSsrf: true,
        },
      });
    expect(expApiRes.status).toBe(201);
    const routeId = expApiRes.body.routeId as string;

    // 7a. Rate-limit verification (traffic_burst against 12 RPM policy)
    const [burstExp] = await db
      .insert(experiments)
      .values({
        id: uuidv4(),
        routeId,
        type: 'traffic_burst',
        status: 'QUEUED',
        config: { durationMs: 4000 },
        startedAt: new Date(),
      })
      .returning();
    invalidateExpCache(routeId);

    await runExperimentLogic(burstExp.id);

    const [burstVerification] = await db
      .select()
      .from(verifications)
      .where(eq(verifications.experimentId, burstExp.id));
    expect(burstVerification).toBeDefined();
    expect(burstVerification.verdict).toBe('PASS');
    expect((burstVerification.observed as any).phases.baseline.observedCount).toBeGreaterThanOrEqual(5);
    expect((burstVerification.observed as any).phases.injection.rateLimited429).toBeGreaterThan(0);
    expect((burstVerification.observed as any).phases.recovery.observedCount).toBeGreaterThanOrEqual(5);

    // 7b. Latency resilience verification (raise RPM so latency probes aren't rate-limited)
    await db
      .update(securityPolicies)
      .set({ rateLimitRpm: 500 })
      .where(eq(securityPolicies.routeId, routeId));

    const [latExp] = await db
      .insert(experiments)
      .values({
        id: uuidv4(),
        routeId,
        type: 'latency',
        status: 'QUEUED',
        config: { latencyMs: 220, durationMs: 2200 },
        startedAt: new Date(),
      })
      .returning();
    invalidateExpCache(routeId);

    await runExperimentLogic(latExp.id);

    const [latVerification] = await db
      .select()
      .from(verifications)
      .where(eq(verifications.experimentId, latExp.id));
    expect(latVerification).toBeDefined();
    expect(latVerification.verdict).toBe('PASS');
    expect((latVerification.observed as any).phases.injection.avgLatencyMs).toBeGreaterThanOrEqual(160);
    expect((latVerification.observed as any).phases.recovery.serverError5xx).toBe(0);
  }, 25_000);

  it('8. exports a valid, secret-free OpenAPI 3.0.3 specification via control plane and gateway', async () => {
    const listRes = await request(app)
      .get(`/api/control/studio/apis?projectId=${tenantAProjectId}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    const studioApi = listRes.body.find((a: any) => a.basePath === '/api/store');
    expect(studioApi).toBeDefined();

    const exportRes = await request(app)
      .get(`/api/control/studio/apis/${studioApi.id}/openapi?projectId=${tenantAProjectId}&download=1`)
      .set('Authorization', `Bearer ${tenantAToken}`);

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-disposition']).toContain('attachment;');
    expect(exportRes.body.openapi).toBe('3.0.3');
    expect(exportRes.body.servers[0].url).toBe(`/proxy/${studioApi.routeId}`);
    expect(exportRes.body.components.securitySchemes.ApiKeyAuth).toBeDefined();
    expect(exportRes.body.components.schemas.Products).toBeDefined();
    expect(exportRes.body.paths['/api/store/products']).toBeDefined();
    expect(exportRes.body.paths['/api/store/products/{id}']).toBeDefined();

    // Verify zero broken $ref pointers and zero leaked internal credentials
    const rawSpec = JSON.stringify(exportRes.body);
    expect(rawSpec).not.toContain('fortix-studio.internal');
    expect(rawSpec).not.toContain('secretHash');
    expect(rawSpec).not.toContain('DATABASE_URL');

    const refRegex = /"\$ref":\s*"#\/components\/schemas\/([^"]+)"/g;
    let match;
    while ((match = refRegex.exec(rawSpec)) !== null) {
      expect(exportRes.body.components.schemas[match[1]]).toBeDefined();
    }
  });
});
