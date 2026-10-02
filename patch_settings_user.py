content = open('src/pages/Settings.tsx').read()
content = content.replace('<AlertingSettings />', '<AlertingSettings user={user} />')
open('src/pages/Settings.tsx', 'w').write(content)
