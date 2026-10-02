import re
content = open('src/pages/Threats.tsx').read()
content = content.replace('bg-[#161618]', 'bg-card')
open('src/pages/Threats.tsx', 'w').write(content)
