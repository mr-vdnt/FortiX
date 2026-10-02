import { db } from './src/db/index.js';
import { apiRoutes } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function run() {
  await db.update(apiRoutes).set({ targetUrl: 'https://httpbin.org/get' }).where(eq(apiRoutes.id, 'route-1'));
  console.log('Fixed route target');
  process.exit(0);
}
run();
