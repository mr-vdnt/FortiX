const fs = require('fs');
const path = './src/api/auth.ts';
let code = fs.readFileSync(path, 'utf-8');
code = code.replace(
  `    res.cookie('fortix_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    res.json({ user: { id: user.id, email: user.email, role: user.role } });`,
  `    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });`
);
fs.writeFileSync(path, code);
