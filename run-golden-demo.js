import fetch from 'node-fetch';
import PDFDocument from 'pdfkit';
import fs from 'fs';

let logText = [];
const originalLog = console.log;
console.log = function(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  logText.push(line);
  originalLog.apply(console, args);
}


const API_BASE = 'http://127.0.0.1:3000';
let token = '';
let projectId = '';
let routeId = '';
let apiKeyRaw = '';
let experimentId = '';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log("=========================================");
  console.log(" FORTIX GOLDEN DEMO EXECUTION SCRIPT");
  console.log("=========================================\n");

  // 1. Login
  console.log("[1] Logging in as admin@fortix.dev...");
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fortix.dev', password: 'admin' })
  });
  const loginData = await loginRes.json();
  if (!loginData.token) throw new Error("Login failed");
  token = loginData.token;
  console.log("    ✅ Login successful, got JWT.\n");

  // 2. Select Project
  console.log("[2] Fetching projects...");
  const projRes = await fetch(`${API_BASE}/api/control/projects`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const projects = await projRes.json();
  projectId = projects[0].id;
  console.log(`    ✅ Selected project: ${projects[0].name} (${projectId})\n`);

  // 3. Register fortix-demo-api route
  console.log("[3] Registering target route...");
  const routeRes = await fetch(`${API_BASE}/api/control/routes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      path: '/api/v1/payment',
      targetUrl: 'http://fortix-demo-api/api/payment',
      authRequired: true
    })
  });
  const route = await routeRes.json();
  routeId = route.id;
  console.log(`    ✅ Registered route: ${route.path} -> ${route.targetUrl} (ID: ${routeId})\n`);

  // 4. Configure Authorization / Create API Key
  console.log("[4] Creating API Key...");
  const keyRes = await fetch(`${API_BASE}/api/control/keys`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, name: 'Golden Demo Key' })
  });
  const keyData = await keyRes.json();
  apiKeyRaw = keyData.rawKey;
  console.log(`    ✅ Created API Key: ${apiKeyRaw.substring(0, 8)}***\n`);

  // 5. Configure Rate Limit Policy
  console.log("[5] Configuring Rate Limit Policy...");
  const policyRes = await fetch(`${API_BASE}/api/control/policies`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      routeId,
      name: 'Standard Rate Limit',
      type: 'rate_limit',
      config: { requestsPerMinute: 20 }
    })
  });
  console.log(`    ✅ Rate limit configured.\n`);

  // 6. Send Valid Request
  console.log("[6] Testing valid request through Gateway...");
  const startValid = Date.now();
  const validReq = await fetch(`${API_BASE}/proxy/${routeId}`, {
    headers: { 'x-api-key': apiKeyRaw }
  });
  const rawText = await validReq.text();
  let validData = {};
  try { validData = JSON.parse(rawText); } catch(e) { validData = rawText; }
  console.log(`    ✅ Status: ${validReq.status} (${Date.now() - startValid}ms) | Response:`, validData);
  console.log("");

  // 7. Test Invalid API Key
  console.log("[7] Testing invalid API key...");
  const invalidReq = await fetch(`${API_BASE}/proxy/${routeId}`, {
    headers: { 'x-api-key': 'pk_invalid.secret' }
  });
  console.log(`    ✅ Status: ${invalidReq.status} | Response:`, await invalidReq.json());
  console.log("");

  // 8. Test Suspicious Request (Threat)
  console.log("[8] Testing suspicious request (Path Traversal)...");
  const threatReq = await fetch(`${API_BASE}/proxy/${routeId}?file=../../../etc/passwd`, {
    headers: { 'x-api-key': apiKeyRaw }
  });
  console.log(`    ✅ Status: ${threatReq.status} | Response:`, await threatReq.json());
  console.log("");

  // 9. Trigger Rate Limit Burst
  console.log("[9] Triggering Rate Limit Burst (25 requests, limit is 20)...");
  let rlHits = 0;
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${API_BASE}/proxy/${routeId}`, { headers: { 'x-api-key': apiKeyRaw } });
    if (r.status === 429) rlHits++;
  }
  console.log(`    ✅ Received ${rlHits} Rate Limit (429) responses.\n`);

  // 10. Launch Latency Experiment
  console.log("[10] Launching Latency Experiment (800ms)...");
  const expRes = await fetch(`${API_BASE}/api/control/experiments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      routeId,
      type: 'latency',
      config: { latencyMs: 800 }
    })
  });
  const expData = await expRes.json();
  experimentId = expData.id;
  console.log(`    ✅ Experiment launched (ID: ${experimentId}). Status: ${expData.status}\n`);

  // 11. Wait for completion & Live Telemetry Test
  console.log("[11] Waiting for Experiment execution (12 seconds)...");
  await delay(12000); // Wait for worker burst

  // 12. Check Experiment Status
  const expsRes = await fetch(`${API_BASE}/api/control/experiments?projectId=${projectId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const allExps = await expsRes.json();
  const currentExp = allExps.find(e => e.id === experimentId);
  console.log(`    ✅ Experiment completed. Final status: ${currentExp?.status || 'UNKNOWN'}\n`);

  // 13. Check Verifications
  console.log("[12] Fetching Policy Verifications...");
  const verifRes = await fetch(`${API_BASE}/api/control/verifications?projectId=${projectId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const verifications = await verifRes.json();
  const expVerification = verifications.find(v => v.experimentId === experimentId);
  if (expVerification) {
    console.log(`    ✅ Verification found!`);
    console.log(`       - Expected:`, JSON.stringify(expVerification.expectedResult));
    console.log(`       - Observed:`, JSON.stringify(expVerification.observedResult));
    console.log(`       - Result:   ${expVerification.passed ? 'PASS' : 'FAIL'}\n`);
  } else {
    console.log(`    ❌ No verification found for this experiment.\n`);
  }

  // 14. Check Scores
  console.log("[13] Fetching Security & Resilience Scores...");
  const scoresRes = await fetch(`${API_BASE}/api/control/metrics/scores?projectId=${projectId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const scores = await scoresRes.json();
  console.log(`    ✅ Security Score:   ${scores.securityScore}/100`);
  console.log(`    ✅ Resilience Score: ${scores.resilienceScore}/100\n`);

  console.log("=========================================");
  console.log(" GOLDEN DEMO COMPLETED SUCCESSFULLY");

  console.log("[14] Generating Evidence PDF...");
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream('fortix-evidence.pdf'));
  doc.fontSize(18).text('FortiX - Golden Demo Execution Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).font('Courier');
  
  logText.forEach(line => {
    doc.text(line);
  });
  
  doc.end();
  originalLog("    ✅ Evidence PDF saved to fortix-evidence.pdf");

  console.log("=========================================");
}

run().catch(console.error);
