sed -i 's/\\`ratelimit:\${routeId}:\${identifier}\\`/`ratelimit:${routeId}:${identifier}`/g' src/rate-limit/redis.ts
sed -i 's/\\`/`/g' src/rate-limit/redis.ts
