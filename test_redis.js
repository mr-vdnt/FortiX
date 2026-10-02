import { redisConnection } from './src/redis.js';
async function test() {
  console.log('STATUS:', redisConnection.status);
  try {
    await redisConnection.ping();
    console.log('PING SUCCESS');
  } catch (e) {
    console.log('PING ERROR', e);
  }
  process.exit(0);
}
test();
