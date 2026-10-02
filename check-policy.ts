import { db } from './src/db/index.js';
import { securityPolicies } from './src/db/schema.js';
async function run() {
  const policies = await db.select().from(securityPolicies);
  console.log(policies);
  process.exit(0);
}
run();
