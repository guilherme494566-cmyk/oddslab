// Ligação ao Upstash Redis (REST), sem dependências. Variáveis criadas pela integração da Vercel.
const U = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const K = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ok = () => !!(U() && K());
async function pipe(cmds) {
  if (!ok()) throw new Error('sem-redis');
  if (!cmds.length) return [];
  const r = await fetch(U().replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + K(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  const j = await r.json(); return j.map((x) => (x && 'result' in x ? x.result : null));
}
const hobj = (arr) => { const o = {}; if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const dia = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' });
module.exports = { ok, pipe, hobj, dia };
