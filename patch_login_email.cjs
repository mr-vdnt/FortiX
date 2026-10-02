const fs = require('fs');
const path = './src/components/Login.tsx';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `useState('admin@fortix.dev')`,
  `useState('admin@fortix.test')`
);
fs.writeFileSync(path, code);
