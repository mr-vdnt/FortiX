import fetch from 'node-fetch';
const API_BASE = 'http://127.0.0.1:3000';
async function run() {
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fortix.dev', password: 'admin' })
  });
  const token = (await loginRes.json()).token;

  const projRes = await fetch(`${API_BASE}/api/control/projects`, { headers: { 'Authorization': `Bearer ${token}` }});
  const projectId = (await projRes.json())[0].id;

  const routeRes = await fetch(`${API_BASE}/api/control/routes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, path: '/api/v1/test-fail2', targetUrl: 'http://fortix-demo-api/api/payment', authRequired: false })
  });
  const routeId = (await routeRes.json()).id;
  
  console.log("Calling route:", routeId);
  const res = await fetch(`${API_BASE}/proxy/${routeId}`);
  console.log("Status with Redis fault injected:", res.status);
  console.log("Response:", await res.text());
}
run();
