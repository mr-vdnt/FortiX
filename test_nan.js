import fetch from 'node-fetch';
async function run() {
  const r = await fetch('http://127.0.0.1:3000/api/control/metrics/scores?projectId=test');
  console.log(await r.json());
}
run();
