const fs = require('fs');
const path = './src/api/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `const token = req.cookies?.fortix_token;`,
  `const token = req.headers['x-fortix-token'] as string;`
);
fs.writeFileSync(path, code);
