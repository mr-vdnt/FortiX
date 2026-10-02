import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';
async function test() {
  try {
    const res = await db.execute(sql`SELECT 1`);
    console.log('DB SUCCESS', res);
  } catch (e) {
    console.log('DB ERROR', e.message);
  }
  process.exit(0);
}
test();
