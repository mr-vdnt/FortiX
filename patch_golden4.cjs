const fs = require('fs');
let code = fs.readFileSync('tests/e2e/golden-demo.spec.ts', 'utf8');
code = code.replace("const faultReq = await request.get(`/proxy/${routeId}/health`, {\n      headers: { 'X-API-Key': rawKey, 'x-experiment-id': experiment.id }\n    });", 
`
    const keyRes2 = await request.post('/api/control/keys', {
      headers: { Authorization: \`Bearer \${TOKEN}\` },
      data: { projectId: TEST_PROJECT_ID, name: 'Golden Key 2' }
    });
    const rawKey2 = (await keyRes2.json()).rawKey;
    
    const faultReq = await request.get(\`/proxy/\${routeId}/health\`, {
      headers: { 'X-API-Key': rawKey2, 'x-experiment-id': experiment.id }
    });`);
fs.writeFileSync('tests/e2e/golden-demo.spec.ts', code);
