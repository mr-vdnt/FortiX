const fs = require('fs');
const path = './src/middleware/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `    let token = req.cookies?.fortix_token;\n    if (!token && req.headers.authorization?.startsWith('Bearer ')) {\n      token = req.headers.authorization.split(' ')[1];\n    }\n    if (!token) return res.status(401).json({ error: 'Unauthorized' });`,
  `    // Use a custom header to avoid collision with AI Studio's injected Authorization header\n    let token = req.headers['x-fortix-token'];\n    if (!token) return res.status(401).json({ error: 'Unauthorized' });`
);
fs.writeFileSync(path, code);
