import re

content = open('src/App.tsx').read()
content = content.replace('px-3 py-2 rounded text-muted', 'px-3 py-2 rounded-xl text-muted')
content = content.replace('px-4 py-2 rounded focus:outline-none', 'px-4 py-2 rounded-xl focus:outline-none')
content = content.replace('rounded bg-primary', 'rounded-xl bg-primary')
open('src/App.tsx', 'w').write(content)

content = open('src/pages/Dashboard.tsx').read()
content = content.replace('rounded-lg', 'rounded-2xl')
content = content.replace('p-4 rounded-lg', 'p-5 rounded-2xl')
open('src/pages/Dashboard.tsx', 'w').write(content)

print("Refined glass borders")
