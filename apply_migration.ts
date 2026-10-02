import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';

async function apply() {
  const file = fs.readdirSync('drizzle').find(f => f.endsWith('.sql'));
  if (!file) throw new Error('No SQL file found');
  const ddl = fs.readFileSync('drizzle/' + file, 'utf8');
  console.log('Applying migration...');
  await db.execute(sql.raw(ddl));
  console.log('Migration applied.');
  process.exit(0);
}

apply().catch(console.error);
