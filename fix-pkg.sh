sed -i 's/"start": "node dist\/server.cjs"/"start": "cross-env NODE_ENV=production node dist\/server.cjs"/g' package.json
