import fetch from 'node-fetch';

async function runAudit() {
  console.log("Starting FortiX Audit...");
  
  // 1. SSRF Check
  const ssrfRes = await fetch('http://localhost:3000/proxy/route-1', {
    headers: { 'x-api-key': 'some-key' }
  });
  console.log("SSRF Target Proxy (Missing Key):", ssrfRes.status);
  
  // Need to login and get token, set up a route, test rate limit
}
runAudit();
