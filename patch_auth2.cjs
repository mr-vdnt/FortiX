const fs = require('fs');

let code = fs.readFileSync('src/api/auth.ts', 'utf8');
code = code.replace("const { v4: uuidv4 } = require('uuid');", "import { v4 as uuidv4 } from 'uuid';");
code = code.replace("const { v4: uuidv4 } = require('uuid');", ""); // in case it replaced in block
if (!code.includes("import { v4 as uuidv4 } from 'uuid';")) {
   code = "import { v4 as uuidv4 } from 'uuid';\n" + code;
} else {
   code = code.replace("    import { v4 as uuidv4 } from 'uuid';", "");
   if (!code.includes("import { v4 as uuidv4 } from 'uuid';")) {
     code = "import { v4 as uuidv4 } from 'uuid';\n" + code;
   }
}
// just standard cleanup
code = fs.readFileSync('src/api/auth.ts', 'utf8');
code = code.replace("import { v4 as uuidv4 } from 'uuid';", "");
code = code.replace("const { v4: uuidv4 } = require('uuid');", "");
code = "import { v4 as uuidv4 } from 'uuid';\n" + code;
code = code.replace("    const [user] = await db.insert(users).values({", "    const [user] = await db.insert(users).values({\n      id: uuidv4(),");
fs.writeFileSync('src/api/auth.ts', code);
