import os

content = open('src/gateway/index.ts').read()

# Replace Date.now() logic with process.hrtime.bigint()
content = content.replace("const startMs = Date.now();", "const startHrTime = process.hrtime.bigint();")

# Replace latencyMs calculation for injected error
content = content.replace(
"""        const duration = Date.now() - startMs;
        const logId = uuidv4();""",
"""        const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1000000;
        const logId = uuidv4();"""
)
content = content.replace("latencyMs: duration", "latencyMs: Math.round(durationMs)")

# Replace latencyMs calculation for proxyRes and error in proxy
content = content.replace("const duration = Date.now() - startMs;", "const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1000000;")

open('src/gateway/index.ts', 'w').write(content)
print("Patched gateway.ts")
