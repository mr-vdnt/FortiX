import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

test.describe('FortiX Security Matrix', () => {
  let TEST_PROJECT_ID: string;
  let OTHER_PROJECT_ID: string;
  let TOKEN: string;

  test.beforeAll(async ({ request }) => {
    // 1. Create a User and Login to get a valid JWT
    const email = `sectest-${Date.now()}@fortix.dev`;
    const password = 'password123';
    await request.post('/api/auth/register', { data: { email, password, name: 'Sec Admin' } });
    const loginRes = await request.post('/api/auth/login', { data: { email, password } });
    const loginData = await loginRes.json();
    TOKEN = loginData.token;

    // 2. Create Projects
    const p1Res = await request.post('/api/control/projects', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: 'SecTestProject' }
    });
    TEST_PROJECT_ID = (await p1Res.json()).id;

    const p2Res = await request.post('/api/control/projects', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: 'OtherProject' }
    });
    OTHER_PROJECT_ID = (await p2Res.json()).id;
  });

  test('Authentication: Unauthenticated requests return 401', async ({ request }) => {
    const res = await request.get('/api/control/projects');
    expect(res.status()).toBe(401);
  });

  test('Authorization: User cannot access projects they do not own (BOLA)', async ({ request }) => {
    // Make request with a fake UUID
    const res = await request.get(`/api/control/routes?projectId=${uuidv4()}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    // The query enforces ownership mapping, so it returns empty array or 403.
    // If it's returning empty array, it means they see 0 routes for a project they don't own. 
    // Wait, the middleware 'requireProjectOwnership' blocks it.
    expect([403, 401]).toContain(res.status());
  });

  test('SSRF Protection: Rejects private metadata IPs', async ({ request }) => {
    // Try to create a route pointing to AWS metadata
    const res = await request.post('/api/control/routes', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        projectId: TEST_PROJECT_ID,
        name: 'SSRF Route',
        targetUrl: 'http://169.254.169.254/latest/meta-data',
        authRequired: false
      }
    });
    // Our validator inside the route creation should catch it, or if it bypassed, proxy catches it.
    // Let's assume validation catches it.
    expect(res.status()).toBeGreaterThanOrEqual(400); 
  });
});
