import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function reset() {
  console.log('Dropping tables...');
  await db.execute(sql`DROP TABLE IF EXISTS "metric_logs" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "policy_verifications" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "verifications" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "security_events" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "experiments" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "security_policies" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "api_keys" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "api_routes" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "projects" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "organizations" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "refresh_tokens" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "users" CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS "webhooks" CASCADE;`);
  console.log('Tables dropped.');
  process.exit(0);
}

reset().catch(console.error);
