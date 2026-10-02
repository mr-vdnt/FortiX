import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as dotenv from 'dotenv';

dotenv.config({ override: true });

const connectionString = process.env.DATABASE_URL || 'postgres://fortix:fortix_password@127.0.0.1:5432/fortix_db';

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, { 
  prepare: false, 
  ssl: "require",
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30
});

export const db = drizzle(client, { schema });
