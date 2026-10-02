import { runMigrations } from './migrate.js';
import { logger } from '../lib/logger.js';

export async function initDatabase(): Promise<void> {
  try {
    logger.info('[Database] Initializing automated database migrations...');
    await runMigrations();
    logger.info('[Database] Automated database migrations applied successfully.');
  } catch (error) {
    logger.warn({ err: error }, '[Database] Database migration not completed on startup, proceeding with fallback mode.');
  }
}
