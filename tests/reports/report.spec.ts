import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('Phase 7: Evidence & Reporting', () => {
  let token: string;
  let projectId: string;
  
  test.beforeAll(async ({ request }) => {
    // 1. Register User and create Project
    const user = `report-user-${Date.now()}@test.com`;

    const reg = await request.post(`${API_URL}/api/auth/register`, { data: { email: user, password: 'password123', name: 'Test User' } });
    
    const login = await request.post(`${API_URL}/api/auth/login`, { data: { email: user, password: 'password123' } });
    const data = await login.json();
    token = data.token;
    
    
    const projReq = await request.post(`${API_URL}/api/control/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Reporting Project' }
    });
    projectId = (await projReq.json()).id;
  });

  test('Should generate an evidence PDF report', async ({ request }) => {
    
    const res = await request.post(`${API_URL}/api/control/reports/verify-1234`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { projectId, details: 'WAF SQLi test PASS\nWebSocket Auth test PASS' }
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    
    const pdfData = await res.body();
    expect(pdfData.length).toBeGreaterThan(100);
  });
});
