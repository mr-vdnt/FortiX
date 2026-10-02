import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
async function test() {
  try {
    const res = await sql`SELECT 1`;
    console.log('DB SUCCESS', res);
  } catch (e) {
    console.log('DB ERROR', e.message);
  }
  process.exit(0);
}
test();
