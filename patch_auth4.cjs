const fs = require('fs');

let code = fs.readFileSync('tests/reports/report.spec.ts', 'utf8');
code = code.replace("console.log('Reg Response:', await reg.text());", "");
code = code.replace("console.log('Login Response:', data);", "");
code = code.replace("console.log('Token is', token);", "");
fs.writeFileSync('tests/reports/report.spec.ts', code);
