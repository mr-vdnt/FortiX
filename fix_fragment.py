content = open('src/components/AlertingSettings.tsx').read()
content = content.replace(") : (\\n          <p", ") : (\\n          <>\\n          <p")
content = content.replace("          )}\\n        </div>", "          </>\\n          )}\\n        </div>")
open('src/components/AlertingSettings.tsx', 'w').write(content)
