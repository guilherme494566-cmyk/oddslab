// Stripe pela API REST, sem dependências. A chave secreta fica na base de dados (painel → Stripe).
const R = require('./redis.js');
const VER = '2024-06-20';
const PLANOS = {
  pro_m: { nome: 'ODDSLAB PRO', plano: 'pro', cent: 499, int: 'month' },
  pro_a: { nome: 'ODDSLAB PRO anual', plano: 'pro', cent: 3999, int: 'year' },
  elite_m: { nome: 'ODDSLAB ELITE', plano: 'elite', cent: 1499, int: 'month' },
  elite_a: { nome: 'ODDSLAB ELITE anual', plano: 'elite', cent: 11999, int: 'year' },
  tm: { nome: 'Tip Master do dia', plano: 'tm', cent: 499, int: null },
};
const LK = (k) => 'oddslab_' + k;
function form(o, pre = '', out = []) {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const key = pre ? `${pre}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.push(encodeURIComponent(`${key}[${i}]`) + '=' + encodeURIComponent(x))));
    else if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
async function key() { if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY; if (!R.ok()) return ''; const [k] = await R.pipe([['HGET', 'cfg', 'stripeKey']]); return k || ''; }
async function api(method, path, params, sk) {
  sk = sk || (await key()); if (!sk) throw new Error('Stripe por ligar');
  const url = (process.env.STRIPE_API_BASE || 'https://api.stripe.com') + '/v1' + path + (method === 'GET' && params ? '?' + form(params) : '');
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + sk, 'Stripe-Version': VER, 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : form(params || {}) });
  const j = await r.json(); if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Stripe ' + r.status); e.stripe = j.error; throw e; } return j;
}
async function precos(sk) {
  const j = await api('GET', '/prices', { 'lookup_keys': Object.keys(PLANOS).map(LK), active: 'true', limit: 20 }, sk);
  const m = {}; (j.data || []).forEach((p) => { const k = String(p.lookup_key || '').replace(/^oddslab_/, ''); if (PLANOS[k]) m[k] = p.id; }); return m;
}
async function criarProdutos(sk) {
  const m = await precos(sk);
  for (const [k, P] of Object.entries(PLANOS)) {
    if (m[k]) continue;
    const prod = await api('POST', '/products', { name: P.nome, metadata: { oddslab: k } }, sk);
    const pr = await api('POST', '/prices', { product: prod.id, unit_amount: P.cent, currency: 'eur', lookup_key: LK(k), transfer_lookup_key: 'true', recurring: P.int ? { interval: P.int } : undefined, metadata: { oddslab: k } }, sk);
    m[k] = pr.id;
  }
  return m;
}
module.exports = { PLANOS, api, key, precos, criarProdutos };
