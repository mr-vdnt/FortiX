const fs = require('fs');
let config = fs.readFileSync('playwright.config.ts', 'utf8');
config = config.replace(/timeout:\s*\d+,/g, 'timeout: 10000,');
fs.writeFileSync('playwright.config.ts', config);
