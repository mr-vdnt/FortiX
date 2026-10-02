import os
content = open('src/worker.ts').read()
content = content.replace("  /* @ts-ignore */\n  repeat: { pattern: '0 * * * *' }\n});", "} as any);")
content = content.replace("  repeat: { pattern: '0 * * * *' }\n});", "} as any);")
with open('src/worker.ts', 'w') as f:
    f.write(content)
