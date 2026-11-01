// Acesso pago ao ODDSLAB.
// Variáveis de ambiente na Vercel:
//   ODDSLAB_PRIVATE_KEY  chave privada (PEM) que abre data/pago.enc e assina os códigos
//   ODDSLAB_ADMIN        palavra-passe do dono para criar códigos em /admin
// GET  /api/acesso?c=CODIGO          -> dados do plano do código
// GET  /api/acesso?acao=teste        -> código PRO de 7 dias
// POST /api/acesso?acao=codigo       -> {senha, plano: pro|elite|tm, dias} cria um código (só o dono)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { paraPlano } = require('../tools/subconjunto.js');
const R = require('../tools/redis.js');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', PLANS = { 1: 'pro', 2: 'elite', 3: 'tm', 4: 'dono' }, PN = { pro: 1, elite: 2, tm: 3, dono: 4 };
const pk = () => (process.env.ODDSLAB_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const hkey = () => crypto.createHash('sha256').update('oddslab-codigos|' + pk()).digest();
function b32(buf) { let bits = 0, v = 0, o = ''; for (const x of buf) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) o += B32[(v << (5 - bits)) & 31]; return o; }
function unb32(s) { let bits = 0, v = 0; const o = []; for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) return null; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); }
const today = () => Math.floor(Date.now() / 864e5);
function make(plano, dias) {
  const p = Buffer.alloc(6); p[0] = PN[plano]; p.writeUInt16BE(today() + dias, 1); crypto.randomBytes(3).copy(p, 3);
  const sig = crypto.createHmac('sha256', hkey()).update(p).digest().subarray(0, 5);
  const s = b32(Buffer.concat([p, sig])); return 'OL-' + s.match(/.{1,4}/g).join('-');
}
function check(code) {
  const s = String(code || '').toUpperCase().replace(/^OL-?/, '').replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const b = unb32(s); if (!b || b.length < 11) return { erro: 'Código inválido.' };
  const p = b.subarray(0, 6), sig = b.subarray(6, 11), want = crypto.createHmac('sha256', hkey()).update(p).digest().subarray(0, 5);
  if (!crypto.timingSafeEqual(sig, want)) return { erro: 'Código inválido.' };
  const plano = PLANS[p[0]], fim = p.readUInt16BE(1); if (!plano) return { erro: 'Código inválido.' };
  if (fim < today()) return { erro: 'Este código já expirou.' };
  return { plano, expira: (fim + 1) * 864e5 - 1 };
}
let CACHE = null;
function dados() {
  const f = path.join(__dirname, '..', 'data', 'pago.enc'), st = fs.statSync(f);
  if (CACHE && CACHE.m === st.mtimeMs) return CACHE.d;
  const e = JSON.parse(fs.readFileSync(f, 'utf8'));
  const key = crypto.privateDecrypt({ key: pk(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(e.k, 'base64'));
  const dc = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64')); dc.setAuthTag(Buffer.from(e.tag, 'base64'));
  const d = JSON.parse(Buffer.concat([dc.update(Buffer.from(e.d, 'base64')), dc.final()]).toString('utf8'));
  CACHE = { m: st.mtimeMs, d }; return d;
}
function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.end(JSON.stringify(obj)); }
async function body(req) { if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
module.exports = async (req, res) => {
  try {
    if (!pk()) return send(res, 503, { erro: 'Os acessos ainda estão a ser ativados.' });
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (q.acao === 'codigo') {
      if (req.method !== 'POST') return send(res, 405, { erro: 'Usa POST.' });
      const b = await body(req), adm = process.env.ODDSLAB_ADMIN || '';
      const ok = adm && b.senha && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(b.senha)).digest(), crypto.createHash('sha256').update(adm).digest());
      if (!ok) { await new Promise((r) => setTimeout(r, 800)); return send(res, 401, { erro: 'Palavra-passe errada.' }); }
      const plano = PN[b.plano] ? b.plano : 'pro', dias = Math.max(0, Math.min(3650, Number(b.dias) || 30));
      const codigo = make(plano, plano === 'tm' ? 0 : dias), v = check(codigo);
      if (R.ok()) { try { await R.pipe([['HSET', 'code:' + codigo, 'plano', plano, 'dias', String(dias), 'nome', String(b.nome || '').slice(0, 60), 'contacto', String(b.contacto || '').slice(0, 80), 'valor', String(Number(String(b.valor || '0').replace(',', '.')) || 0), 'nota', String(b.nota || '').slice(0, 120), 'criado', String(Date.now()), 'expira', String(v.expira), 'tipo', plano === 'dono' ? 'dono' : 'venda'], ['ZADD', 'codes', String(Date.now()), codigo]]); } catch {} }
      return send(res, 200, { codigo, plano, dias });
    }
    if (q.acao === 'teste') {
      const c = make('pro', 7), v = check(c), uid = /^u_[a-z0-9]{8,16}$/.test(q.u || '') ? q.u : '';
      if (R.ok()) { try { await R.pipe([['HSET', 'code:' + c, 'plano', 'pro', 'dias', '7', 'nome', '', 'valor', '0', 'criado', String(Date.now()), 'expira', String(v.expira), 'tipo', 'teste'], ['ZADD', 'codes', String(Date.now()), c]]); } catch {} }
      return send(res, 200, { codigo: c, ...v, teste: true });
    }
    const v = check(q.c); if (v.erro) return send(res, 401, v);
    const uid = /^u_[a-z0-9]{8,16}$/.test(q.u || '') ? q.u : '';
    if (uid && R.ok()) { try { const code = 'OL-' + String(q.c).toUpperCase().replace(/^OL-?/, '').replace(/[^0-9A-Z]/g, '').match(/.{1,4}/g).join('-'); const r = await R.pipe([['HGET', 'code:' + code, 'nome'], ['SADD', 'cdev:' + code, uid], ['HSET', 'code:' + code, 'ultimo', String(Date.now())], ['HSET', 'u:' + uid, 'codigo', code, 'planoPago', v.plano, 'expira', String(v.expira), 'dono', v.plano === 'dono' ? '1' : '0']]); if (r[0]) await R.pipe([['HSETNX', 'u:' + uid, 'nome', r[0]]]); } catch {} }
    return send(res, 200, { ...v, dados: paraPlano(dados(), v.plano, Date.now()) });
  } catch (e) { return send(res, 500, { erro: 'Erro no servidor.' }); }
};
module.exports._make = make; module.exports._check = check;
