import os
content = open('src/gateway/ssrf.ts').read()

old_regex = "return !hostname.match(/^127\.|^169\.254\.|^0\.|localhost/i);"
new_regex = "return !hostname.match(/^127\.|^169\.254\.|^0\.|localhost|^::1$|^0:0:0:0:0:0:0:1$/i);"
content = content.replace(old_regex, new_regex)

with open('src/gateway/ssrf.ts', 'w') as f:
    f.write(content)

