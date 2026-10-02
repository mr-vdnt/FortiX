const fs = require('fs');
let code = fs.readFileSync('tests/reports/report.spec.ts', 'utf8');
code = code.replace("await request.post(`${API_URL}/api/auth/register`, { data: { email: user, password: 'password123' } });", "const reg = await request.post(`${API_URL}/api/auth/register`, { data: { email: user, password: 'password123', name: 'Test User' } });\n    console.log('Reg Response:', await reg.text());");
fs.writeFileSync('tests/reports/report.spec.ts', code);
