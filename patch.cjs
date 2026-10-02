const fs = require('fs');
const path = './src/middleware/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(/const authHeader = req\.headers\.authorization;\s*if \(!authHeader \|\| !authHeader\.startsWith\('Bearer '\)\) \{\s*return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\);\s*\}\s*const token = authHeader\.split\(' '\)\[1\];/, `let token = req.cookies?.fortix_token;\n    if (!token && req.headers.authorization?.startsWith('Bearer ')) {\n      token = req.headers.authorization.split(' ')[1];\n    }\n    if (!token) return res.status(401).json({ error: 'Unauthorized' });`);
fs.writeFileSync(path, code);
