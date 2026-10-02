# Deployment Guide

FortiX is designed to be easily deployable in modern containerized environments.

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

- `DATABASE_URL`: The PostgreSQL connection string.
- `REDIS_URL`: The Redis connection string.
- `JWT_SECRET`: Cryptographic secret for signing auth tokens.

## Running Locally (Node.js)

1. Ensure Postgres and Redis are running.
2. Install dependencies: `npm install`
3. Push database schema: `npm run db:push`
4. Start the server: `npm run dev` (or `npm start` for production builds).

## Production Architecture Considerations

For a production deployment, consider the following decoupling:
1. **Gateway Nodes**: Horizontally scale the Express application running the `proxy` routes.
2. **Control Plane Nodes**: Run a separate cluster for `/api/control/*`.
3. **Worker Nodes**: Run dedicated Node.js instances solely dedicated to executing the BullMQ worker processors.
