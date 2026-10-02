const fs = require('fs');

let code = fs.readFileSync('src/api/index.ts', 'utf8');
code = code.replace("import { resourcesRouter } from './resources.js';", "import { resourcesRouter } from './resources.js';\nimport reportsRouter from './reports.js';");
code = code.replace("app.use('/api/control/resources', authenticate, requireEntitlement('TOPOLOGY'), resourcesRouter);", "app.use('/api/control/resources', authenticate, requireEntitlement('TOPOLOGY'), resourcesRouter);\n  app.use('/api', reportsRouter);");
fs.writeFileSync('src/api/index.ts', code);
