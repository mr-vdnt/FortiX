import { db } from './src/db/index.js';
import { users } from './src/db/schema.js';
async function run() {
  const allUsers = await db.select().from(users);
  console.log('Users in DB:');
  console.log(allUsers.map(u => ({ id: u.id, email: u.email, role: u.role })));
  process.exit(0);
}
run();
