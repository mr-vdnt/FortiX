content = open('src/App.tsx').read()

theme_state = """  const [searchQuery, setSearchQuery] = React.useState('');
  const [theme, setTheme] = React.useState(() => localStorage.getItem("fortix_theme") || "light");

  React.useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("fortix_theme", theme);
  }, [theme]);
"""
content = content.replace("  const [searchQuery, setSearchQuery] = React.useState('');", theme_state)

open('src/App.tsx', 'w').write(content)
print("Fixed theme state")
