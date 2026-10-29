import { isLocalDatabaseHost, normalizeDatabaseUrl } from '../db/url.js';
import { normalizeRedisUrl } from '../redis.js';

export interface DependencyHealthSnapshot {
  status: string;
  postgres: {
    status: string;
    latencyMs?: number;
    error?: string;
    storageMode: 'persistent' | 'in-memory';
    migrationStatus?: 'verified' | 'pending' | 'failed';
    migrationError?: string;
  };
  redis: {
    status: string;
    latencyMs?: number;
    error?: string;
    storageMode: 'persistent' | 'in-memory';
  };
}

export interface ReadinessEvaluation {
  httpStatus: 200 | 503;
  isReady: boolean;
  status: 'ok' | 'ephemeral_ready' | 'degraded' | 'unhealthy';
  deploymentMode: 'persistent' | 'hybrid' | 'ephemeral-sandbox' | 'unhealthy';
  persistenceVerified: boolean;
  postgresReady: boolean;
  redisReady: boolean;
  warnings: string[];
}

export function hasExplicitRemoteDatabaseConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const conn = normalizeDatabaseUrl(env.DATABASE_URL);
  if (!conn) return false;
  if (conn.includes('your_strong_database_password_here')) return false;
  if (conn.includes('memory')) return false;
  if (env.FORCE_IN_MEMORY === 'true') return false;
  if (
    conn.includes('render.com') &&
    env.RENDER !== 'true' &&
    env.USE_RENDER_DB !== 'true' &&
    env.STRICT_PERSISTENT_DB !== 'true'
  ) {
    return false;
  }
  if (isLocalDatabaseHost(conn) && env.USE_LOCAL_POSTGRES !== 'true') return false;
  return true;
}

export function hasExplicitRemoteRedisConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = normalizeRedisUrl(env.REDIS_URL);
  if (!raw) return false;
  if (env.FORCE_IN_MEMORY_REDIS === 'true') return false;
  if (raw.includes('red-') && !raw.includes('.render.com')) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return env.USE_REAL_REDIS === 'true';
    }
    return true;
  } catch {
    return false;
  }
}

export function evaluateReadinessContract(
  health: DependencyHealthSnapshot,
  env: NodeJS.ProcessEnv = process.env
): ReadinessEvaluation {
  const isTest = (env.NODE_ENV === 'test' || Boolean(env.VITEST)) && env.TEST_READINESS_CONTRACT !== 'true';
  const strictDb = env.STRICT_PERSISTENT_DB === 'true' || (!isTest && hasExplicitRemoteDatabaseConfig(env));
  const strictRedis = env.STRICT_REDIS_READINESS === 'true' || (!isTest && hasExplicitRemoteRedisConfig(env));

  const warnings: string[] = [];

  const pgHealthy =
    health.postgres?.status === 'healthy' &&
    health.postgres?.migrationStatus !== 'failed';
  const pgPersistent = health.postgres?.storageMode === 'persistent';
  const postgresReady = pgHealthy && (!strictDb || pgPersistent);

  const rdHealthy = health.redis?.status === 'healthy';
  const rdPersistent = health.redis?.storageMode === 'persistent';
  const redisReady = rdHealthy && (!strictRedis || rdPersistent);

  if (!pgPersistent) {
    warnings.push(
      strictDb
        ? 'Persistent PostgreSQL is required (STRICT_PERSISTENT_DB or configured DATABASE_URL), but runtime is in-memory or unreachable.'
        : 'PostgreSQL is running in ephemeral sandbox mode (pg-mem). Configure DATABASE_URL for durable persistence across restarts.'
    );
  }
  if (health.postgres?.migrationStatus === 'failed') {
    warnings.push(`Database migrations failed: ${health.postgres.migrationError || 'migration error'}`);
  }
  if (!rdPersistent) {
    warnings.push(
      strictRedis
        ? 'Persistent Redis is required (STRICT_REDIS_READINESS or configured REDIS_URL), but runtime is using in-memory fallback.'
        : 'Redis is running in ephemeral in-memory mode. Configure REDIS_URL for multi-instance queues and distributed rate limits.'
    );
  }

  const isReady = postgresReady && redisReady;
  const persistenceVerified = isReady && pgPersistent && rdPersistent;

  if (!isReady) {
    return {
      httpStatus: 503,
      isReady: false,
      status: 'unhealthy',
      deploymentMode: 'unhealthy',
      persistenceVerified: false,
      postgresReady,
      redisReady,
      warnings,
    };
  }

  if (pgPersistent && rdPersistent) {
    return {
      httpStatus: 200,
      isReady: true,
      status: health.status === 'healthy' ? 'ok' : 'degraded',
      deploymentMode: 'persistent',
      persistenceVerified: true,
      postgresReady,
      redisReady,
      warnings,
    };
  }

  if (pgPersistent || rdPersistent) {
    return {
      httpStatus: 200,
      isReady: true,
      status: 'degraded',
      deploymentMode: 'hybrid',
      persistenceVerified: false,
      postgresReady,
      redisReady,
      warnings,
    };
  }

  return {
    httpStatus: 200,
    isReady: true,
    status: 'ephemeral_ready',
    deploymentMode: 'ephemeral-sandbox',
    persistenceVerified: false,
    postgresReady,
    redisReady,
    warnings,
  };
}
