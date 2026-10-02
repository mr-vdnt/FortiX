import { redisConnection } from "../redis.js";
import * as dotenv from 'dotenv';
import { db } from '../db/index.js';
import { securityPolicies } from '../db/schema.js';
import { eq } from 'drizzle-orm';

dotenv.config({ override: true });

const redis = redisConnection;
const fallbackStore = new Map<string, { tokens: number, lastRefill: number }>();

export async function checkRateLimit(projectId: string, routeId: string, identifier: string) {
  // Phase 4: Atomic Token Bucket via Lua
  const key = `ratelimit:${routeId}:${identifier}`;
  
  // Fetch dynamic limits from the database policy
  let limit = 20;
  let refillRate = 20;
  try {
    const [policy] = await db.select().from(securityPolicies).where(eq(securityPolicies.routeId, routeId));
    if (policy && policy.rateLimitRpm) {
      limit = policy.rateLimitRpm;
      refillRate = policy.rateLimitRpm;
    }
  } catch (err) {
    console.error('[Rate Limit] DB Policy lookup failed, using defaults', err);
  }
  
  if (redis.status !== 'ready') {
     console.warn('[Rate Limit] Redis not ready, using fallback in-memory store');
     let bucket = fallbackStore.get(key) || { tokens: limit, lastRefill: Date.now() };
     const now = Date.now();
     const timePassed = Math.max(0, now - bucket.lastRefill);
     const refill = Math.floor(timePassed * (refillRate / 60000));
     
     if (refill > 0) {
       bucket.tokens = Math.min(limit, bucket.tokens + refill);
       bucket.lastRefill = now;
     }
     
     let allowed = false;
     if (bucket.tokens > 0) {
       bucket.tokens -= 1;
       allowed = true;
     }
     
     fallbackStore.set(key, bucket);
     return { allowed, limit, remaining: bucket.tokens };
  }

  const script = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local refillRate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    
    local bucket = redis.call("HMGET", key, "tokens", "last_refill")
    local tokens = tonumber(bucket[1])
    local last_refill = tonumber(bucket[2])
    
    if not tokens then
      tokens = capacity
      last_refill = now
    end
    
    local time_passed = math.max(0, now - last_refill)
    local refill = math.floor(time_passed * (refillRate / 60000))
    
    if refill > 0 then
      tokens = math.min(capacity, tokens + refill)
      last_refill = now
    end
    
    local allowed = 0
    if tokens > 0 then
      tokens = tokens - 1
      allowed = 1
    end
    
    redis.call("HMSET", key, "tokens", tokens, "last_refill", last_refill)
    redis.call("PEXPIRE", key, 60000)
    
    return { allowed, tokens }
  `;
  
  try {
    const result = await redis.eval(script, 1, key, limit, refillRate, Date.now()) as [number, number];
    
    return {
      allowed: result[0] === 1,
      limit,
      remaining: result[1]
    };
  } catch (error) {
    console.error('[Rate Limit] Redis error, failing closed according to REDIS_FAILURE_BEHAVIOR policy');
    // For rate-limiting a fail-closed behavior ensures security is not degraded during an infrastructure fault.
    // Explicitly set fail-closed per security policy rule 33 (fails closed).
    return {
      allowed: false,
      limit,
      remaining: 0
    };
  }
}
