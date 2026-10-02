import { db } from './src/db/index.js';
import { apiKeys, securityEvents, experiments } from './src/db/schema.js';
import fetch from 'node-fetch';

async function run() {
  console.log('\n--- Triggering Experiment ---');
  let res = await fetch('http://localhost:3000/api/control/experiments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
       projectId: 'proj-1',
       routeId: 'route-1',
       type: 'latency',
       config: { latencyMs: 800, durationMs: 15000 }
    })
  });
  console.log('Status:', res.status);
  
  if (res.ok) {
     const data = await res.json();
     console.log(data);
  } else {
     const text = await res.text();
     console.log(text);
  }
}
run().catch(console.error);
