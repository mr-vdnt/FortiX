const fs = require('fs');
const path = './src/App.tsx';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `fetch('/api/auth/me').then(res => {`,
  `fetch('/api/auth/me', { headers: { 'X-Fortix-Token': localStorage.getItem('fortix_token') || '' } }).then(res => {`
);
code = code.replace(
  `fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());`,
  `localStorage.removeItem('fortix_token'); window.location.reload();`
);
code = code.replace(
  `fetch('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload());`,
  `localStorage.removeItem('fortix_token'); window.location.reload();`
);
fs.writeFileSync(path, code);
