sed -i 's/error.errors/error.issues/g' src/api/auth.ts
sed -i 's/error.errors/error.issues/g' src/api/keys.ts
sed -i 's/error.errors/error.issues/g' src/api/routes.ts
sed -i 's/const routeId = req.params.routeId;/const routeId = req.params.routeId as string;/g' src/gateway/index.ts
sed -i 's/eq(apiKeys.id, id)/eq(apiKeys.id, id as string)/g' src/api/keys.ts
sed -i 's/!res.headersSent/!(res as Response).headersSent/g' src/gateway/index.ts
