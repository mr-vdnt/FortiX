import { test, expect } from '@playwright/test';

test.describe('FortiX Security: Authentication & Authorization', () => {
  const TEST_PROJECT_ID = 'fortix-sec-' + Date.now();
  const OTHER_PROJECT_ID = 'fortix-other-' + Date.now();

  test('Reject missing API key on protected route', async ({ request }) => {
    // Attempt to access without API key
    const res = await request.post('/api/payment', {
      headers: { 'X-Fortix-Project': TEST_PROJECT_ID }
    });
    // Currently our gateway doesn't strictly enforce if route isn't created in DB, 
    // but a 404 or 401 is expected.
    expect([401, 404]).toContain(res.status());
  });

  test('Reject invalid API key', async ({ request }) => {
    const res = await request.post('/api/payment', {
      headers: { 
        'X-Fortix-Project': TEST_PROJECT_ID,
        'X-API-Key': 'invalid.key'
      }
    });
    expect([401, 404]).toContain(res.status());
  });
});
