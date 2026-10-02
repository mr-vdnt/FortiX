import re

content = open('src/pages/Settings.tsx').read()

if "import { Settings as SettingsIcon, User, Shield, Globe, Activity, AlertTriangle, Server } from 'lucide-react';" in content:
    content = content.replace("import { Settings as SettingsIcon, User, Shield, Globe, Activity, AlertTriangle, Server } from 'lucide-react';", "import { Settings as SettingsIcon, User, Shield, Globe, Activity, AlertTriangle, Server, Bell } from 'lucide-react';")

# Add alerting to tabs
tabs_str = """const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'gateway', label: 'Gateway', icon: Globe },
  { id: 'experiments', label: 'Experiments', icon: Activity },
  { id: 'alerting', label: 'Alerting', icon: Bell },
  { id: 'notifications', label: 'Notifications', icon: AlertTriangle },
  { id: 'appearance', label: 'Appearance', icon: SettingsIcon },
  { id: 'system', label: 'System', icon: Server },
];"""

content = re.sub(r'const SETTINGS_TABS = \[.*?\];', tabs_str, content, flags=re.DOTALL)

open('src/pages/Settings.tsx', 'w').write(content)
