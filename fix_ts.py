import os

# Fix 1: req.headers string cast
idx = open('src/api/index.ts').read()
idx = idx.replace("req.id = req.headers['x-request-id'] || uuidv4();", "req.id = (req.headers['x-request-id'] as string) || uuidv4();")
with open('src/api/index.ts', 'w') as f:
    f.write(idx)

# Fix 2: BullMQ repeat object
worker = open('src/worker.ts').read()
worker = worker.replace("repeat: { cron: '0 * * * *' }", "repeat: { pattern: '0 * * * *' }")
with open('src/worker.ts', 'w') as f:
    f.write(worker)

print("TS errors fixed.")
