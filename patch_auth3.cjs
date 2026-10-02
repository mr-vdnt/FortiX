const fs = require('fs');

let code = fs.readFileSync('src/api/auth.ts', 'utf8');
code = code.replace("      id: uuidv4(),\n      id: uuidv4(),", "      id: uuidv4(),");
fs.writeFileSync('src/api/auth.ts', code);
