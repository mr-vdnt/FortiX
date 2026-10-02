content = open('src/App.tsx').read()

import_statement = "import { Menu, X, ShieldAlert, Activity, Server, Database, Code2, Globe, Settings, FileText, Zap, LogOut, Moon, Sun } from 'lucide-react';"
if 'Moon, Sun' not in content:
    content = content.replace("import { Menu, X, ShieldAlert, Activity, Server, Database, Code2, Globe, Settings, FileText, Zap, LogOut } from 'lucide-react';", import_statement)

# Add theme state to App component
if 'const [theme, setTheme] = useState' not in content:
    content = content.replace('const [searchQuery, setSearchQuery] = useState("");', 'const [searchQuery, setSearchQuery] = useState("");\n  const [theme, setTheme] = useState(() => localStorage.getItem("fortix_theme") || "dark");\n\n  useEffect(() => {\n    if (theme === "dark") {\n      document.documentElement.classList.add("dark");\n    } else {\n      document.documentElement.classList.remove("dark");\n    }\n    localStorage.setItem("fortix_theme", theme);\n  }, [theme]);')

toggle_button = """          <div className="flex items-center pl-4 border-l border-subtle gap-4">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center gap-2 text-muted hover:text-strong transition-colors"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button"""
content = content.replace("""          <div className="flex items-center pl-4 border-l border-subtle">
            <button""", toggle_button)

open('src/App.tsx', 'w').write(content)
print("Added theme toggle")
