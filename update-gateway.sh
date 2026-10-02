sed -i 's/export function setupGateway/import { broadcast } from "..\/socket.js";\nimport { securityEvents } from "..\/db\/schema.js";\n\nexport function setupGateway/g' src/gateway/index.ts
