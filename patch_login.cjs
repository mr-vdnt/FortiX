const fs = require('fs');
const path = './src/components/Login.tsx';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `      onLogin();`,
  `      localStorage.setItem('fortix_token', data.token);\n      onLogin();`
);
fs.writeFileSync(path, code);
