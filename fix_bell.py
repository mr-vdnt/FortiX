content = open('src/pages/Settings.tsx').read()
content = content.replace("AlertTriangle,", "AlertTriangle, Bell,")
open('src/pages/Settings.tsx', 'w').write(content)
