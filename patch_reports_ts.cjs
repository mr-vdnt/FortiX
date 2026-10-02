const fs = require('fs');
let code = fs.readFileSync('src/api/reports.ts', 'utf8');
code = code.replace(/\\$\{/g, '${');
fs.writeFileSync('src/api/reports.ts', code);
