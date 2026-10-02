content = open('src/App.tsx').read()
content = content.replace("      </footer>\n    </div>\n  );", "      </footer>\n      </div>\n    </div>\n  );")
open('src/App.tsx', 'w').write(content)
