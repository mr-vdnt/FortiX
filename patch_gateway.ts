import fs from 'fs';

let content = fs.readFileSync('src/gateway/index.ts', 'utf8');

// Replace auth check
const oldAuth = `      // 3. API Key Auth
      let apiKeyId = null;
      if (route.authRequired) {
        const rawKey = req.headers['x-api-key'] as string;
        if (!rawKey) return res.status(401).json({ error: 'Missing API Key' });
        
        const parts = rawKey.split('.');
        if (parts.length !== 2) {
          return res.status(401).json({ error: 'Malformed API Key' });
        }
        
        const [keyId, secret] = parts;
        
        const [k] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
        
        let validKey = null;
        if (k && k.projectId === route.projectId && !k.revoked) {
          const isValid = await bcrypt.compare(secret, k.keyHash);
          if (isValid) {
            validKey = k;
          }
        }
        
        if (!validKey) {`;

const newAuth = `      // 3. API Key Auth
      let apiKeyId = null;
      if (route.authRequired) { // TODO fallback for route.authRequired is absent, handle properly? wait, apiRoutes no longer has authRequired in V2 contract. Let's fix that.
`;

fs.writeFileSync('src/gateway/index.ts', content);
