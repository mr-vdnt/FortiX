sed -i "s/const projectId = 'proj-1';/const projectId = localStorage.getItem('fortix_project_id') || '';/g" src/pages/*.tsx
