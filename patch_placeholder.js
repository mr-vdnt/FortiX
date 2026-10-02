const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  'placeholder="Search APIs by name or status..."',
  'placeholder="Search or jump to... (Ctrl+K)"'
);

fs.writeFileSync('src/App.tsx', content);
console.log('Placeholder patched');
