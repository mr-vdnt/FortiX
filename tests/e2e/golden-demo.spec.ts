import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('FortiX Full Lifecycle Verification', () => {
  let TEST_PROJECT_ID: string;
  let TOKEN: string;

  test.beforeEach(async ({ request }) => {
    // 1. LOGIN / INITIALIZATION - using REAL JWT provisioning
    const email = `golden-${Date.now()}@fortix.dev`;
    const password = 'password123';
    await request.post('/api/auth/register', { data: { email, password, name: 'Golden Admin' } });
    const loginRes = await request.post('/api/auth/login', { data: { email, password } });
    const loginData = await loginRes.json();
    TOKEN = loginData.token;

    const pRes = await request.post('/api/control/projects', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: 'Golden Demo Project' }
    });
    TEST_PROJECT_ID = (await pRes.json()).id;
  });

  test('Golden Path: Protect, Observe, Break, Measure, Prove', async ({ request }) => {
    // 1. Create Target API Route
    const routeRes = await request.post('/api/control/routes', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        projectId: TEST_PROJECT_ID,
        targetUrl: 'http://fortix-demo-api',
        pathPattern: '/api/demo/1'
      }
    });
    console.log(await routeRes.text());
expect(routeRes.ok()).toBeTruthy();
    const route = await routeRes.json();
    const routeId = route.id;

    // 2. Create API Key
    const keyRes = await request.post('/api/control/keys', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { projectId: TEST_PROJECT_ID, name: 'Golden Key' }
    });
    const key = await keyRes.json();
    console.log('KEY RES:', key);
    const rawKey = key.rawKey;

    // 3. Normal Request (Protect & Observe)
    const normalReq = await request.get(`/proxy/${routeId}/health`, {
      headers: { 'X-API-Key': rawKey }
    });
    expect(normalReq.status()).toBe(200);

    // 4. Malicious Request (WAF / Threat)
    const maliciousReq = await request.get(`/proxy/${routeId}?q=SELECT%20*%20FROM%20users`, {
      headers: { 'X-API-Key': rawKey }
    });
    expect(maliciousReq.status()).toBe(403);

    // 5. Rate Limit Burst
    // Sending concurrent requests to trip the token bucket
    const burstReqs = Array(30).fill(0).map(() => request.get(`/proxy/${routeId}/health`, { headers: { 'X-API-Key': rawKey } }));
    const burstResults = await Promise.all(burstReqs);
    const has429 = burstResults.some(res => res.status() === 429);
    expect(has429).toBe(true);

    // 6. Chaos Fault Injection
    const expRes = await request.post('/api/control/experiments', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        projectId: TEST_PROJECT_ID,
        routeId,
        type: 'latency',
        config: { latencyMs: 800, durationMs: 5000 }
      }
    });
    if(!expRes.ok()) console.log('EXP ERR:', await expRes.text());
    expect(expRes.ok()).toBeTruthy();
    const experiment = await expRes.json();

    // Give the BullMQ worker a moment to pick it up and run it
    await new Promise(r => setTimeout(r, 1000));
    
    const startFault = Date.now();
    
    const keyRes2 = await request.post('/api/control/keys', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { projectId: TEST_PROJECT_ID, name: 'Golden Key 2' }
    });
    const rawKey2 = (await keyRes2.json()).rawKey;
    
    const faultReq = await request.get(`/proxy/${routeId}/health`, {
      headers: { 'X-API-Key': rawKey2, 'x-experiment-id': experiment.id }
    });
    const duration = Date.now() - startFault;
    
    // 7. Measure & Prove
    // The request should have experienced ~800ms of latency
    expect(faultReq.status()).toBe(200);
    expect(duration).toBeGreaterThanOrEqual(750); 
    
    // Meanwhile, another route should NOT be affected
    const route2Res = await request.post('/api/control/routes', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        projectId: TEST_PROJECT_ID,
        targetUrl: 'http://fortix-demo-api',
        pathPattern: '/api/demo/2'
      }
    });
    const route2Id = (await route2Res.json()).id;
    
    const startIsolated = Date.now();
    const res2 = await request.get(`/proxy/${route2Id}/health`, { headers: { 'X-API-Key': rawKey } });
    const durationIsolated = Date.now() - startIsolated;
    expect(res2.status()).toBe(200);
    // Expected to be fast because no fault is injected for route2Id
    expect(durationIsolated).toBeLessThan(600);

    // Wait for experiment to finish (TTL cleanup/worker end)
    await new Promise(r => setTimeout(r, 6000));
  });
});
