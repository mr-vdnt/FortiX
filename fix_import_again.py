content = open('src/App.tsx').read()
content = content.replace("} , Moon, Sun } from 'lucide-react';", ", Moon, Sun } from 'lucide-react';")
open('src/App.tsx', 'w').write(content)
