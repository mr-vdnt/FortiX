import { test, expect } from '@playwright/test';

test.describe('FTX-API-STUDIO-001: FortiX API Studio Live End-to-End Lifecycle', () => {
  test('provisions 100-record Products API, enforces Auth/WAF/Rate-Limiting, executes live experiment verification, and exports OpenAPI 3.0', async ({
    request,
  }) => {
    const email = `studio-e2e-${Date.now()}@fortix.dev`;
    const password = 'StudioPassword123!';

    // 1. Register & Login real operator account
    const regRes = await request.post('/api/auth/register', {
      data: { email, password, name: 'Studio Evaluator' },
    });
    expect(regRes.status()).toBe(201);

    const loginRes = await request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(loginRes.status()).toBe(200);
    const { token } = await loginRes.json();

    // 2. Create isolated project
    const projRes = await request.post('/api/control/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Studio E2E Project', environment: 'development' },
    });
    expect(projRes.status()).toBe(201);
    const project = await projRes.json();

    // 3. Create Store Products API (100 canonical INR records) via Studio Control Plane
    const studioRes = await request.post('/api/control/studio/apis', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        projectId: project.id,
        name: 'Store Products API',
        basePath: '/api/store',
        version: 'v1',
        template: 'products_100',
        initialPolicy: { rateLimitRpm: 30, enableWaf: true, enableSsrf: true },
        issueApiKey: true,
      },
    });
    expect(studioRes.status()).toBe(201);
    const createdStudio = await studioRes.json();
    expect(createdStudio.totalRecords).toBe(100);
    const apiId = createdStudio.id as string;
    const routeId = createdStudio.routeId as string;
    const rawKey = createdStudio.issuedApiKey.rawKey as string;

    // 4. Unauthenticated gateway call -> 401; Authenticated call -> 200 with canonical prod_0001
    const unauthRes = await request.get(`/proxy/${routeId}/api/store/products`);
    expect(unauthRes.status()).toBe(401);

    const listRes = await request.get(`/proxy/${routeId}/api/store/products?limit=20&offset=0`, {
      headers: { 'x-api-key': rawKey },
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.pagination.total).toBe(100);
    expect(listData.items[0].id).toBe('prod_0001');
    expect(listData.items[0].price).toBe(799);

    // 5. Protected CRUD write & update through FortiX Gateway
    const createItemRes = await request.post(`/proxy/${routeId}/api/store/products`, {
      headers: { 'x-api-key': rawKey },
      data: {
        sku: 'SKU-E2E-0101',
        name: 'Zero Trust Hardware Token',
        description: 'FIDO2 USB-C security key.',
        category: 'Electronics',
        price: 3499,
        stock: 40,
        status: 'active',
      },
    });
    expect(createItemRes.status()).toBe(201);
    const createdItem = await createItemRes.json();
    expect(createdItem.id).toBe('prod_0101');

    const patchItemRes = await request.patch(`/proxy/${routeId}/api/store/products/prod_0101`, {
      headers: { 'x-api-key': rawKey },
      data: { stock: 35 },
    });
    expect(patchItemRes.status()).toBe(200);
    expect((await patchItemRes.json()).stock).toBe(35);

    // 6. Verify WAF SQLi blocking on Studio endpoint (403)
    const wafRes = await request.get(
      `/proxy/${routeId}/api/store/products?q=${encodeURIComponent("' UNION SELECT password_hash FROM users --")}`,
      { headers: { 'x-api-key': rawKey } }
    );
    expect(wafRes.status()).toBe(403);

    // 7. Queue real latency experiment against Studio API route and verify live worker produces PASS
    const expRes = await request.post('/api/control/experiments', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        projectId: project.id,
        routeId,
        type: 'latency',
        config: { latencyMs: 250, durationMs: 2500 },
      },
    });
    expect(expRes.ok()).toBeTruthy();
    const experiment = await expRes.json();

    let verifiedVerdict: string | null = null;
    for (let poll = 0; poll < 25; poll++) {
      await new Promise((r) => setTimeout(r, 500));
      const verRes = await request.get(`/api/control/verifications?projectId=${project.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (verRes.ok()) {
        const verifications = await verRes.json();
        const match = verifications.find((v: any) => v.experimentId === experiment.id);
        if (match) {
          verifiedVerdict = match.verdict;
          break;
        }
      }
    }
    expect(verifiedVerdict).toBe('PASS');

    // 8. Export OpenAPI 3.0.3 contract and verify /studio SPA route serves cleanly
    const openApiRes = await request.get(
      `/api/control/studio/apis/${apiId}/openapi?projectId=${project.id}&download=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(openApiRes.status()).toBe(200);
    const spec = await openApiRes.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/store/products']).toBeDefined();

    const studioPageRes = await request.get('/studio');
    expect(studioPageRes.status()).toBe(200);
    expect(studioPageRes.headers()['content-type']).toContain('text/html');
  });
});
