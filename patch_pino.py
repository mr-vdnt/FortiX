import os
content = open('src/api/index.ts').read()
content = content.replace(
    "app.use(pinoHttp({ logger, genReqId: (req) => req.id }));",
    """const pinoMiddleware = pinoHttp({ logger, genReqId: (req) => req.id });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) {
      pinoMiddleware(req, res, next);
    } else {
      next();
    }
  });"""
)
with open('src/api/index.ts', 'w') as f:
    f.write(content)
print("Patched pino-http")
