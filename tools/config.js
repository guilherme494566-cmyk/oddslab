// Configuração do site: chave privada e palavra-passe do dono.
// Vêm das variáveis da Vercel ou, se faltarem, da base de dados (guardadas em /admin → Configurar).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = require('./redis.js');
let C = null, T = 0;
const norm = (s) => String(s || '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
async function load() {
  if (C && Date.now() - T < 60000) return C;
  const c = { pk: norm(process.env.ODDSLAB_PRIVATE_KEY), admin: process.env.ODDSLAB_ADMIN || '', adminHash: '', salt: '' };
  if ((!c.pk || !c.admin) && R.ok()) {
    try { const [h] = await R.pipe([['HGETALL', 'cfg']]); const o = R.hobj(h); if (!c.pk && o.pk) c.pk = norm(o.pk); if (!c.admin && o.adminHash) { c.adminHash = o.adminHash; c.salt = o.salt || ''; } } catch {}
  }
  C = c; T = Date.now(); return c;
}
const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
async function checkAdmin(pw) {
  const c = await load(); if (!pw) return false;
  const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  if (c.admin) return eq(crypto.createHash('sha256').update(String(pw)).digest('hex'), crypto.createHash('sha256').update(c.admin).digest('hex'));
  if (c.adminHash) return eq(hash(pw, c.salt), c.adminHash);
  return false;
}
function keyMatches(pem) {
  try {
    const pub = crypto.createPublicKey(crypto.createPrivateKey(norm(pem))).export({ type: 'spki', format: 'der' });
    const ref = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, '..', 'data', 'chave-publica.pem'), 'utf8')).export({ type: 'spki', format: 'der' });
    return pub.equals(ref);
  } catch { return false; }
}
async function save(pem, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  await R.pipe([['HSET', 'cfg', 'pk', norm(pem), 'adminHash', hash(pw, salt), 'salt', salt, 'quando', String(Date.now())]]);
  C = null;
}
module.exports = { load, checkAdmin, keyMatches, save, norm };
