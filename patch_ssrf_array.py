content = open('src/gateway/ssrf.ts').read()
content = content.replace("'::1',", "'::1',\n  '[::1]',\n  '[0:0:0:0:0:0:0:1]',")
with open('src/gateway/ssrf.ts', 'w') as f:
    f.write(content)
