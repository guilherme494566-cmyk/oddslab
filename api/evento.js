// Regista a atividade anónima de cada aparelho (identificador aleatório guardado no aparelho).
// POST {uid, info:{plat, std, plano}, ev:[{t, k, d}]}
const R = require('../tools/redis.js');
const KS = new Set(['abrir', 'pagina', 'jogo', 'bloqueado', 'planos', 'comprar', 'teste', 'codigo', 'codigo_erro', 'copiar', 'tutorial', 'instalado', 'entrada', 'cancelar']);
const clip = (v, n = 80) => String(v == null ? '' : v).slice(0, n);
async function body(req) { if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; let s = ''; for await (const c of req) { s += c; if (s.length > 40000) break; } return s ? JSON.parse(s) : {}; }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const end = (c) => { res.statusCode = c; res.end(); };
  if (req.method !== 'POST') return end(405);
  if (!R.ok()) return end(204);
  try {
    const b = await body(req), uid = String(b.uid || '');
    if (!/^u_[a-z0-9]{8,16}$/.test(uid)) return end(400);
    const info = b.info || {}, now = Date.now(), day = R.dia(now);
    const ev = (Array.isArray(b.ev) ? b.ev : []).slice(0, 60).filter((e) => e && KS.has(e.k)).map((e) => {
      const d = {}; if (e.d && typeof e.d === 'object') Object.keys(e.d).slice(0, 6).forEach((k) => (d[clip(k, 20)] = clip(e.d[k])));
      const t = Math.min(now, Math.max(now - 7 * 864e5, Number(e.t) || now));
      return { t, k: e.k, d };
    });
    const pais = clip(req.headers['x-vercel-ip-country'] || '', 4), cidade = clip(decodeURIComponent(req.headers['x-vercel-ip-city'] || ''), 40);
    const cmds = [
      ['HSETNX', 'u:' + uid, 'first', String(now)],
      ['HSET', 'u:' + uid, 'last', String(now), 'plat', clip(info.plat, 10), 'std', info.std ? '1' : '0', 'plano', clip(info.plano, 10), 'pais', pais, 'cidade', cidade, 'ecra', clip(info.ecra, 12)],
      ['ZADD', 'users', String(now), uid],
      ['PFADD', 'hll:' + day, uid],
      ['EXPIRE', 'hll:' + day, String(120 * 86400)],
    ];
    if (ev.length) {
      cmds.push(['HINCRBY', 'u:' + uid, 'n', String(ev.length)]);
      cmds.push(['LPUSH', 'ev:' + uid, ...ev.map((e) => JSON.stringify(e))], ['LTRIM', 'ev:' + uid, '0', '499']);
      cmds.push(['LPUSH', 'feed', ...ev.map((e) => JSON.stringify({ ...e, u: uid }))], ['LTRIM', 'feed', '0', '999']);
      const cnt = {}; ev.forEach((e) => (cnt[e.k] = (cnt[e.k] || 0) + 1));
      Object.entries(cnt).forEach(([k, n]) => cmds.push(['HINCRBY', 'd:' + day, k, String(n)]));
      cmds.push(['EXPIRE', 'd:' + day, String(400 * 86400)]);
      ev.filter((e) => e.k === 'jogo' && e.d.id).forEach((e) => cmds.push(['ZINCRBY', 'jogos:' + day, '1', e.d.id.slice(0, 40)]));
      cmds.push(['EXPIRE', 'jogos:' + day, String(60 * 86400)]);
    }
    const cn = ev.find((e) => e.k === 'cancelar'); if (cn) { cmds.push(['HSET', 'u:' + uid, 'cancelado', String(cn.t)]); if (cn.d.codigo) cmds.push(['HSET', 'code:' + cn.d.codigo, 'cancelado', String(cn.t)]); }
    const r = await R.pipe(cmds);
    if (r[0] === 1) await R.pipe([['HINCRBY', 'd:' + day, 'novos', '1']]);
    return end(204);
  } catch { return end(204); }
};
