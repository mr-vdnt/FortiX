import os
content = open('src/gateway/index.ts').read()
content = content.replace("console.error", "logger.error")
with open('src/gateway/index.ts', 'w') as f:
    f.write(content)
