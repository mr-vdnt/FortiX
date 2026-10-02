const fs = require('fs');
const path = './src/lib/api.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `  const headers = new Headers(options.headers || {});`,
  `  const token = localStorage.getItem('fortix_token');\n  const headers = new Headers(options.headers || {});\n  if (token) {\n    headers.set('X-Fortix-Token', token);\n  }`
);
code = code.replace(
  `fetch('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });`,
  `localStorage.removeItem('fortix_token'); window.location.href = '/';`
);
fs.writeFileSync(path, code);
