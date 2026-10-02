const fs = require('fs');
let code = fs.readFileSync('src/threat-detection/index.ts', 'utf8');
code = code.replace("const url = req.url.toLowerCase();", "const url = decodeURIComponent(req.url).toLowerCase();");
fs.writeFileSync('src/threat-detection/index.ts', code);
