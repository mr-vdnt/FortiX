const fs = require('fs');
const path = './src/api/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `const token = req.headers['x-fortix-token'] as string;`,
  `let token = req.headers['x-fortix-token'] as string;\n    if (!token && req.headers.authorization?.startsWith('Bearer ')) {\n      token = req.headers.authorization.split(' ')[1];\n    }`
);
fs.writeFileSync(path, code);
