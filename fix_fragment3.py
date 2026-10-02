content = open('src/components/AlertingSettings.tsx').read()
content = content.replace("            </button>\n          </>\n          )}", "            </button>\n          )}")
open('src/components/AlertingSettings.tsx', 'w').write(content)
