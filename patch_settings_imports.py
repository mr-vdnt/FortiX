import re
content = open('src/pages/Settings.tsx').read()
if 'import { AlertingSettings }' not in content:
    content = 'import { AlertingSettings } from "../components/AlertingSettings.js";\n' + content
if 'Bell' not in content:
    content = content.replace("AlertTriangle,", "AlertTriangle, Bell,")
open('src/pages/Settings.tsx', 'w').write(content)
