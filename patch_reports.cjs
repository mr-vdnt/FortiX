const fs = require('fs');

let code = fs.readFileSync('src/api/reports.ts', 'utf8');
code = code.replace("import { requireAuth } from '../middleware/auth.js';", "import { authenticate } from '../middleware/auth.js';");
code = code.replace("router.post('/control/reports/:verificationId', requireAuth, async (req, res) => {", "router.post('/control/reports/:verificationId', authenticate, async (req, res) => {");
fs.writeFileSync('src/api/reports.ts', code);
