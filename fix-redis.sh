sed -i 's/import IORedis from .ioredis.;/import { redisConnection } from "..\/redis.js";/g' src/rate-limit/redis.ts
sed -i 's/const redis = new IORedis(.*);/const redis = redisConnection;/g' src/rate-limit/redis.ts

sed -i 's/import IORedis from .ioredis.;/import { redisConnection } from "..\/redis.js";/g' src/experiments/queue.ts
sed -i 's/const connection = new IORedis(.*);/const connection = redisConnection;/g' src/experiments/queue.ts

sed -i 's/import IORedis from .ioredis.;/import { redisConnection } from "..\/redis.js";/g' src/experiments/worker.ts
sed -i 's/const connection = new IORedis(.*);/const connection = redisConnection;/g' src/experiments/worker.ts
