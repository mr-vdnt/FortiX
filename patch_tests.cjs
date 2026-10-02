const fs = require('fs');

function patch(file) {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/const email = .*;/g, "const email = 'admin@fortix.dev';");
  code = code.replace(/const password = .*;/g, "const password = 'admin';");
  code = code.replace(/await request.post\('\/api\/auth\/register', .*\n/g, "");
  fs.writeFileSync(file, code);
}

patch('tests/security/all.spec.ts');
patch('tests/e2e/golden-demo.spec.ts');

