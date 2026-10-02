content = open('src/api/webhooks.ts').read()
content = content.replace('const id = req.params.id;', 'const id = req.params.id as string;')
content = content.replace('const projectId = req.query.projectId as string;', 'const projectId = String(req.query.projectId);')
open('src/api/webhooks.ts', 'w').write(content)
