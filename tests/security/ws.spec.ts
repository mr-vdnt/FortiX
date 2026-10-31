import { test, expect } from '@playwright/test';
import { io as Client } from 'socket.io-client';

const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('WebSocket Security & Isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let projectA: string;
  let projectB: string;
  
  test.beforeAll(async ({ request }) => {
    // 1. Register User A and create Project A
    const userA = `ws-userA-${Date.now()}@test.com`;
    await request.post(`${API_URL}/api/auth/register`, { data: { email: userA, password: 'password123' } });
    const loginA = await request.post(`${API_URL}/api/auth/login`, { data: { email: userA, password: 'password123' } });
    tokenA = (await loginA.json()).token;
    
    const projAReq = await request.post(`${API_URL}/api/control/projects`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: 'Project A WS' }
    });
    projectA = (await projAReq.json()).id;

    // 2. Register User B and create Project B
    const userB = `ws-userB-${Date.now()}@test.com`;
    await request.post(`${API_URL}/api/auth/register`, { data: { email: userB, password: 'password123' } });
    const loginB = await request.post(`${API_URL}/api/auth/login`, { data: { email: userB, password: 'password123' } });
    tokenB = (await loginB.json()).token;
    
    const projBReq = await request.post(`${API_URL}/api/control/projects`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { name: 'Project B WS' }
    });
    projectB = (await projBReq.json()).id;
  });

  test('Should successfully subscribe to own project and receive isolated events', async ({ request }) => {
    const socketA = Client(API_URL, { auth: { token: tokenA }, reconnection: false, timeout: 5000 });
    const socketB = Client(API_URL, { auth: { token: tokenB }, reconnection: false, timeout: 5000 });
    
    await Promise.all([
      new Promise((resolve) => socketA.on('connect', () => resolve(undefined))),
      new Promise((resolve) => socketB.on('connect', () => resolve(undefined)))
    ]);

    // Setup listeners before emitting
    const healthA = new Promise((resolve) => socketA.on('system:health', resolve));
    const healthB = new Promise((resolve) => socketB.on('system:health', resolve));

    socketA.emit('subscribe:project', projectA);
    socketB.emit('subscribe:project', projectB);

    // Wait for health check events to confirm subscription
    await Promise.all([healthA, healthB]);

    // Track received events
    const eventsA: any[] = [];
    const eventsB: any[] = [];

    const firstEventAPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for security:event on Tenant A socket')), 6000);
      socketA.on('security:event', (data) => {
        eventsA.push(data);
        clearTimeout(timer);
        resolve(data);
      });
    });

    socketB.on('security:event', (data) => {
      eventsB.push(data);
    });

    // Verify cross-tenant subscription attempt by Tenant B to Project A is explicitly denied
    const crossTenantErrorPromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expected unauthorized error on cross-tenant subscribe')), 4000);
      socketB.once('error', (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });
    socketB.emit('subscribe:project', projectA);
    const crossTenantErr = await crossTenantErrorPromise;
    expect(crossTenantErr?.message).toMatch(/Unauthorized access to project/i);

    // Generate a security event for Project A by triggering WAF on a valid proxy route
    const routePath = `/ws-waf-test-${Date.now()}`;
    const routeReq = await request.post(`${API_URL}/api/control/routes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        projectId: projectA,
        pathPattern: routePath,
        targetUrl: 'http://fortix-demo-api:3001/health',
      },
    });
    expect(routeReq.status()).toBe(201);
    const route = await routeReq.json();

    const keyReq = await request.post(`${API_URL}/api/control/keys`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { projectId: projectA, name: 'Test WS Key' },
    });
    expect(keyReq.status()).toBe(201);
    const key = await keyReq.json();

    // Trigger WAF SQLi event on Project A's route
    const wafRes = await request.get(`${API_URL}/proxy/${route.id}?q=SELECT%20*%20FROM%20users`, {
      headers: { 'X-API-Key': key.rawKey },
    });
    expect(wafRes.status()).toBe(403);

    const receivedEvent = await firstEventAPromise;
    // Allow brief observation window to confirm Tenant B never receives Tenant A's event
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(eventsA.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvent.projectId).toBe(projectA);
    expect(receivedEvent.payload?.routeId).toBe(route.id);
    expect(eventsB).toHaveLength(0);

    socketA.disconnect();
    socketB.disconnect();
  });
});
