const fs = require('fs');
let code = fs.readFileSync('src/threat-detection/index.ts', 'utf8');
code = code.replace("const url = decodeURIComponent(req.originalUrl).toLowerCase();", "const url = decodeURIComponent(req.originalUrl || req.url).toLowerCase();\n  console.log('DETECT THREATS CHECKING URL:', url, 'ORIGINAL:', req.originalUrl, 'REQURL:', req.url);");
fs.writeFileSync('src/threat-detection/index.ts', code);
