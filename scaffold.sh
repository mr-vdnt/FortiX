mkdir -p src/middleware src/api src/gateway src/rate-limit src/policies src/threat-detection src/experiments src/verification src/metrics src/scoring src/events

# Empty placeholder files for now, will populate via other scripts
touch src/middleware/auth.ts
touch src/api/auth.ts
touch src/api/projects.ts
touch src/api/routes.ts
touch src/api/keys.ts
touch src/api/policies.ts
touch src/api/experiments.ts
touch src/api/metrics.ts
touch src/api/verifications.ts
touch src/gateway/index.ts
touch src/gateway/ssrf.ts
touch src/rate-limit/redis.ts
touch src/policies/engine.ts
touch src/threat-detection/index.ts
touch src/experiments/worker.ts
touch src/verification/engine.ts
touch src/scoring/index.ts

