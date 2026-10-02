import { sql } from 'drizzle-orm';
import { db } from './src/db/index.js';

async function migrate() {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'DEVELOPER';`);
    await db.execute(sql`UPDATE users SET role = 'ADMIN' WHERE email = 'admin@fortix.dev';`);
    await db.execute(sql`ALTER TABLE security_events ADD COLUMN IF NOT EXISTS metadata jsonb;`);
    console.log("Migration successful");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrate();
