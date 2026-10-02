const fs = require('fs');
let code = fs.readFileSync('tests/reports/report.spec.ts', 'utf8');
code = code.replace("headers: { Authorization: `Bearer ${token}` },", "headers: { Authorization: `Bearer ${token}` },");
fs.writeFileSync('tests/reports/report.spec.ts', code);
