// Pagamentos com Stripe Checkout.
// GET  ?acao=estado                      -> {ativo}
// POST ?acao=sessao {k, uid}            -> {url} (k: pro_m, pro_a, elite_m, elite_a, tm)
// POST ?acao=confirmar {s, uid}         -> {codigo, plano, expira, sub}
// POST ?acao=renovar {sub, uid}         -> {codigo, plano, expira} se a subscrição continuar ativa
// POST ?acao=cancelar {sub}             -> cancela a renovação no fim do período
const R = require('../tools/redis.js');
const S = require('../tools/stripe.js');
const CFG = require('../tools/config.js');
const A = require('./acesso.js');
const send = (res, c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
async function body(req) { if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
const okUid = (u) => (/^u_[a-z0-9]{8,16}$/.test(String(u || '')) ? u : '');
const origin = (req) => 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
const diasAte = (sec) => Math.max(1, Math.ceil((sec * 1000 - Date.now()) / 864e5) + 1);
function fimPeriodo(sub) { return sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || 0; }
async function emitir(plano, dias, info) {
  A._setPK((await CFG.load()).pk);
  const codigo = A._make(plano, plano === 'tm' ? 0 : dias), v = A._check(codigo);
  if (R.ok()) {
    const cmds = [['HSET', 'code:' + codigo, 'plano', plano, 'dias', String(dias), 'nome', info.nome || '', 'contacto', info.email || '', 'valor', String(info.valor || 0), 'criado', String(Date.now()), 'expira', String(v.expira), 'tipo', info.tipo || 'stripe', 'sub', info.sub || '', 'sessao', info.sessao || '', 'renovacao', info.renov ? '1' : '0'], ['ZADD', 'codes', String(Date.now()), codigo]];
    if (info.uid) cmds.push(['SADD', 'cdev:' + codigo, info.uid], ['HSET', 'u:' + info.uid, 'codigo', codigo, 'planoPago', plano, 'expira', String(v.expira), 'nome', info.nome || '', 'email', info.email || '']);
    try { await R.pipe(cmds); } catch {}
  }
  return { codigo, plano, expira: v.expira };
}
module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const sk = await S.key();
    if (q.acao === 'estado') {
      return send(res, 200, { ativo: !!sk, teste: /^(sk|rk)_test_/.test(sk) });
    }
    if (!sk) return send(res, 503, { erro: 'Pagamentos por ligar.' });
    if (req.method !== 'POST') return send(res, 405, { erro: 'Usa POST.' });
    const b = await body(req), uid = okUid(b.uid);
    if (q.acao === 'sessao') {
      const P = S.PLANOS[b.k]; if (!P) return send(res, 400, { erro: 'Plano desconhecido.' });
      let M = await S.precos(); if (!M[b.k]) M = await S.criarProdutos();
      const o = origin(req);
      const s = await S.api('POST', '/checkout/sessions', {
        mode: P.int ? 'subscription' : 'payment', line_items: [{ price: M[b.k], quantity: 1 }], locale: 'pt', allow_promotion_codes: 'true',
        success_url: o + '/?pago={CHECKOUT_SESSION_ID}', cancel_url: o + '/?pagamento=cancelado', client_reference_id: uid || undefined,
        metadata: { k: b.k, plano: P.plano, uid, trial: b.trial && P.int === 'year' ? '1' : '' }, subscription_data: P.int ? { metadata: { k: b.k, plano: P.plano, uid }, trial_period_days: b.trial && P.int === 'year' ? 7 : undefined } : undefined,
        customer_creation: P.int ? undefined : 'always',
        payment_method_collection: P.int ? 'always' : undefined,
      });
      return send(res, 200, { url: s.url });
    }
    if (q.acao === 'confirmar') {
      const id = String(b.s || ''); if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return send(res, 400, { erro: 'Sessão inválida.' });
      if (R.ok()) { const [prev] = await R.pipe([['HGETALL', 'cs:' + id]]); const o = R.hobj(prev); if (o.codigo) return send(res, 200, { codigo: o.codigo, plano: o.plano, expira: Number(o.expira), sub: o.sub || '' }); }
      const s = await S.api('GET', '/checkout/sessions/' + id, { 'expand': ['subscription'] });
      if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) return send(res, 402, { erro: 'O pagamento ainda não foi concluído.' });
      const k = (s.metadata && s.metadata.k) || 'pro_m', P = S.PLANOS[k] || S.PLANOS.pro_m, sub = s.subscription && typeof s.subscription === 'object' ? s.subscription : null;
      const dias = sub ? diasAte(fimPeriodo(sub)) : 0;
      const info = { nome: (s.customer_details && s.customer_details.name) || '', email: (s.customer_details && s.customer_details.email) || '', valor: (s.amount_total || 0) / 100, sub: sub ? sub.id : '', sessao: id, uid: uid || okUid(s.client_reference_id) };
      const trial = sub && sub.status === 'trialing';
      if (trial) { info.tipo = 'teste'; info.valor = 0; }
      const r = await emitir(P.plano, dias, info);
      if (R.ok() && s.invoice) { try { await R.pipe([['SADD', 'faturas', typeof s.invoice === 'string' ? s.invoice : s.invoice.id]]); } catch {} }
      if (R.ok()) await R.pipe([['HSET', 'cs:' + id, 'codigo', r.codigo, 'plano', r.plano, 'expira', String(r.expira), 'sub', info.sub], ['EXPIRE', 'cs:' + id, String(400 * 86400)]]);
      return send(res, 200, { ...r, sub: info.sub });
    }
    if (q.acao === 'renovar') {
      const id = String(b.sub || ''); if (!/^sub_[A-Za-z0-9]+$/.test(id)) return send(res, 400, { erro: 'Subscrição inválida.' });
      const sub = await S.api('GET', '/subscriptions/' + id, { expand: ['latest_invoice', 'customer'] });
      if (!['active', 'trialing'].includes(sub.status)) return send(res, 402, { erro: 'A subscrição já não está ativa.', estado: sub.status });
      const k = (sub.metadata && sub.metadata.k) || 'pro_m', P = S.PLANOS[k] || S.PLANOS.pro_m;
      const inv = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null, cu = sub.customer && typeof sub.customer === 'object' ? sub.customer : {};
      let nova = false; if (inv && inv.amount_paid > 0 && R.ok()) { try { const [a] = await R.pipe([['SADD', 'faturas', inv.id]]); nova = a === 1; } catch {} }
      const r = await emitir(P.plano, diasAte(fimPeriodo(sub)), { sub: id, uid, valor: nova ? inv.amount_paid / 100 : 0, renov: !nova, nome: cu.name || '', email: cu.email || '', tipo: sub.status === 'trialing' ? 'teste' : 'stripe' });
      return send(res, 200, r);
    }
    if (q.acao === 'cancelar') {
      const id = String(b.sub || ''); if (!/^sub_[A-Za-z0-9]+$/.test(id)) return send(res, 400, { erro: 'Subscrição inválida.' });
      const sub = await S.api('POST', '/subscriptions/' + id, { cancel_at_period_end: 'true' });
      return send(res, 200, { ok: true, ate: fimPeriodo(sub) * 1000 });
    }
    return send(res, 400, { erro: 'Ação desconhecida.' });
  } catch (e) { return send(res, 500, { erro: e.message || 'Erro no servidor.' }); }
};
