const fs = require('fs');
let code = fs.readFileSync('tests/e2e/golden-demo.spec.ts', 'utf8');
code = code.replace("expect(expRes.ok()).toBeTruthy();", "if(!expRes.ok()) console.log('EXP ERR:', await expRes.text());\n    expect(expRes.ok()).toBeTruthy();");
fs.writeFileSync('tests/e2e/golden-demo.spec.ts', code);
