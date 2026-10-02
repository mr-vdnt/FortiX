const fs = require('fs');
const path = './src/components/Login.tsx';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `useState('admin');`,
  `useState('password123');`
);
fs.writeFileSync(path, code);
