import os

content = open('src/lib/api.ts').read()

old_logic = """  const projectId = localStorage.getItem('fortix_project_id');
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const urlObj = new URL(url, window.location.origin);
  if (projectId && !urlObj.searchParams.has('projectId')) {
    urlObj.searchParams.set('projectId', projectId);
  }"""

new_logic = """  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  const urlObj = new URL(url, window.location.origin);"""

content = content.replace(old_logic, new_logic)

with open('src/lib/api.ts', 'w') as f:
    f.write(content)

print("api.ts patched")
