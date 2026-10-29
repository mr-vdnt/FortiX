import { sql } from 'drizzle-orm';
import { db, isPersistentStorage } from './index.js';

/**
 * Executes a callback inside a database transaction with `app.current_user_id`
 * scoped strictly via `set_config(..., true)` (`SET LOCAL`) so pooled PostgreSQL
 * connections automatically clear tenant context when the transaction ends.
 */
export async function withTenantContext<T>(
  userId: string,
  operation: (tx: typeof db) => Promise<T>
): Promise<T> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('withTenantContext requires a non-empty authenticated userId');
  }

  if (!isPersistentStorage()) {
    // pg-mem does not implement PostgreSQL custom GUC current_setting/set_config;
    // execute within transaction while application-layer ownership checks remain enforced.
    return db.transaction(async (tx: any) => operation(tx));
  }

  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return operation(tx);
  });
}
