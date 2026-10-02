const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts['test:security'] = 'playwright test tests/security';
pkg.scripts['test:e2e'] = 'playwright test tests/e2e';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
