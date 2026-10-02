import { describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { db } from '../../src/db/index.js';
import { sql } from 'drizzle-orm';

describe('TSK-05: Automated Database Migrations (Drizzle)', () => {
  it('executes runMigrations successfully and creates migration tracking schema', async () => {
    await expect(runMigrations()).resolves.not.toThrow();

    // Verify drizzle.__drizzle_migrations exists and has entries
    const migrationRows = await db.execute(sql`
      SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC
    `);
    
    expect(migrationRows.length).toBeGreaterThanOrEqual(1);
    expect(migrationRows[0]).toHaveProperty('hash');
    expect(migrationRows[0]).toHaveProperty('created_at');
  });

  it('is completely idempotent when executed multiple consecutive times', async () => {
    // Run migration twice in succession
    await expect(runMigrations()).resolves.not.toThrow();
    await expect(runMigrations()).resolves.not.toThrow();

    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM drizzle.__drizzle_migrations
    `);
    const count = (countRes[0] as any)?.count;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('ensures all required application tables and constraints are present', async () => {
    const tablesRes = await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    const tableNames = tablesRes.map((t: any) => t.tablename);

    const requiredTables = [
      'users',
      'refresh_tokens',
      'organizations',
      'projects',
      'api_routes',
      'api_keys',
      'security_policies',
      'experiments',
      'verifications',
      'metric_logs',
      'security_events',
      'webhooks',
      'project_settings',
      'audit_logs'
    ];

    for (const table of requiredTables) {
      expect(tableNames, `Missing required table: ${table}`).toContain(table);
    }
  });

  it('fails loudly when database connection fails and does not silently swallow errors', async () => {
    const invalidDbUrl = 'postgres://invalid_user:invalid_pass@127.0.0.1:54329/non_existent_db?connect_timeout=1';
    
    await expect(runMigrations(invalidDbUrl)).rejects.toThrow();
  });
});
