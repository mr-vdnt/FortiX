import os

# 1. Update src/gateway/index.ts to use logger
gateway = open('src/gateway/index.ts').read()
gateway = gateway.replace("console.log(`FortiX API Gateway", "logger.info(`FortiX API Gateway")
gateway = gateway.replace("console.error('Target resolution error:',", "logger.error({ err }, 'Target resolution error:')")
gateway = "import { logger } from '../lib/logger.js';\n" + gateway
with open('src/gateway/index.ts', 'w') as f:
    f.write(gateway)

# 2. Add Request IDs and pino-http to api/index.ts
api_index = open('src/api/index.ts').read()
api_index = api_index.replace("import { sql } from 'drizzle-orm';", "import { sql } from 'drizzle-orm';\nimport pinoHttp from 'pino-http';\nimport { logger } from '../lib/logger.js';\nimport { v4 as uuidv4 } from 'uuid';")

pino_middleware = """export function setupApiRoutes(app: Express) {
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));"""

api_index = api_index.replace("export function setupApiRoutes(app: Express) {", pino_middleware)

with open('src/api/index.ts', 'w') as f:
    f.write(api_index)

print("Pino logger integrated.")
