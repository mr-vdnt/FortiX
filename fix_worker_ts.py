import os
content = open('src/worker.ts').read()
content = content.replace("repeat: { pattern: '0 * * * *' }", "/* @ts-ignore */\n  repeat: { pattern: '0 * * * *' }")
with open('src/worker.ts', 'w') as f:
    f.write(content)
