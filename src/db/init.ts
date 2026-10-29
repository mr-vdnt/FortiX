import { runMigrations } from './migrate.js';
import { hasExplicitRemoteDatabaseConfig } from '../lib/readiness.js';
import { logger } from '../lib/logger.js';

let migrationStatus: 'pending' | 'verified' | 'failed' = 'pending';
let lastMigrationError: string | undefined;
let migrationsVerifiedAt: string | undefined;

export function getMigrationStatus(): {
  status: 'pending' | 'verified' | 'failed';
  error?: string;
  verifiedAt?: string;
} {
  return {
    status: migrationStatus,
    error: lastMigrationError,
    verifiedAt: migrationsVerifiedAt,
  };
}

export async function initDatabase(): Promise<void> {
  try {
    logger.info('[Database] Initializing automated database migrations...');
    await runMigrations();
    migrationStatus = 'verified';
    lastMigrationError = undefined;
    migrationsVerifiedAt = new Date().toISOString();
    logger.info('[Database] Automated database migrations applied successfully.');
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const sanitizedMsg = rawMsg
      .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s'"]+/gi, '[REDACTED_URI]')
      .slice(0, 200);

    migrationStatus = 'failed';
    lastMigrationError = sanitizedMsg;

    const isStrict =
      process.env.STRICT_PERSISTENT_DB === 'true' || hasExplicitRemoteDatabaseConfig(process.env);
    if (isStrict) {
      logger.error(
        { err: sanitizedMsg },
        '[FATAL] Database migration failed with persistent database required/configured.'
      );
      throw new Error(`[FATAL] Database migration failed: ${sanitizedMsg}`);
    }
    logger.warn(
      { err: sanitizedMsg },
      '[Database] Database migration did not complete cleanly; health state marked degraded.'
    );
  }
}
