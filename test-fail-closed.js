import fetch from 'node-fetch';

const API_BASE = 'http://127.0.0.1:3000';
let token = '';
let projectId = '';
let routeId = '';
let apiKeyRaw = '';

async function run() {
  console.log("1. Logging in...");
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fortix.dev', password: 'admin' })
  });
  token = (await loginRes.json()).token;

  console.log("2. Fetching project...");
  const projRes = await fetch(`${API_BASE}/api/control/projects`, { headers: { 'Authorization': `Bearer ${token}` }});
  projectId = (await projRes.json())[0].id;

  console.log("3. Registering route...");
  const routeRes = await fetch(`${API_BASE}/api/control/routes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, path: '/api/v1/test-fail', targetUrl: 'http://fortix-demo-api/api/payment', authRequired: false })
  });
  routeId = (await routeRes.json()).id;

  console.log("4. Sending valid request (should pass)...");
  const res1 = await fetch(`${API_BASE}/proxy/${routeId}`);
  console.log("Status before fault:", res1.status);

  // Now we need to inject the fault into the backend file
  console.log("\n--- INJECTING REDIS FAULT ---");
}
run().catch(console.error);
