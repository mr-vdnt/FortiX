import { test, expect } from '@playwright/test';

test.describe('FortiX Chaos: Worker Failures', () => {
  const TEST_PROJECT_ID = 'fortix-fail-' + Date.now();

  test('Reject invalid experiment payloads', async ({ request }) => {
    // Missing required fields
    const res = await request.post('/api/control/experiments', {
      headers: { 'X-Fortix-Project': TEST_PROJECT_ID },
      data: {
        projectId: TEST_PROJECT_ID,
        type: 'latency'
        // Missing routeId
      }
    });
    // Our control plane should return 400 Bad Request or 403 (due to how route checking happens)
    expect([400, 401, 403]).toContain(res.status());
  });

  test('Reject negative latency duration', async ({ request }) => {
    const res = await request.post('/api/control/experiments', {
      headers: { 'X-Fortix-Project': TEST_PROJECT_ID },
      data: {
        projectId: TEST_PROJECT_ID,
        routeId: 'dummy-route',
        type: 'latency',
        config: { latencyMs: -500 }
      }
    });
    // Should be rejected by schema validation
    expect([400, 401, 403]).toContain(res.status());
  });
});
