const fs = require('fs');
const path = './src/api/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',`,
  `secure: true,
      sameSite: 'none',`
);
fs.writeFileSync(path, code);
