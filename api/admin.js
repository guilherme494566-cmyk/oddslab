// Painel do dono. Cabeçalho x-admin com a palavra-passe ODDSLAB_ADMIN.
// GET ?acao=resumo | utilizadores | utilizador&id= | atividade | codigos
// POST ?acao=nome {id, nome}  -> dá um nome a um utilizador
const crypto = require('crypto');
const R = require('../tools/redis.js');
const send = (res, c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const eqs = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
async function body(req) { if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
async function codigos(lim = 500) {
  const ids = (await R.pipe([['ZREVRANGE', 'codes', '0', String(lim - 1)]]))[0] || [];
  if (!ids.length) return [];
  const r = await R.pipe(ids.flatMap((c) => [['HGETALL', 'code:' + c], ['SMEMBERS', 'cdev:' + c]]));
  return ids.map((c, i) => ({ codigo: c, ...R.hobj(r[i * 2]), aparelhos: r[i * 2 + 1] || [] }));
}
module.exports = async (req, res) => {
  const adm = process.env.ODDSLAB_ADMIN || '';
  if (!adm || !req.headers['x-admin'] || !eqs(req.headers['x-admin'], adm)) { await new Promise((r) => setTimeout(r, 700)); return send(res, 401, { erro: 'Palavra-passe errada.' }); }
  if (!R.ok()) return send(res, 503, { erro: 'Falta ligar a base de dados (Upstash Redis) na Vercel.', semBase: true });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  try {
    if (q.acao === 'resumo') {
      const days = Array.from({ length: 14 }, (_, i) => R.dia(Date.now() - (13 - i) * 864e5));
      const r = await R.pipe([...days.flatMap((d) => [['HGETALL', 'd:' + d], ['PFCOUNT', 'hll:' + d]]), ['ZCARD', 'users'], ['ZCOUNT', 'users', String(Date.now() - 864e5), '+inf'], ['ZCOUNT', 'users', String(Date.now() - 7 * 864e5), '+inf'], ['ZREVRANGE', 'jogos:' + days[13], '0', '9', 'WITHSCORES']]);
      const serie = days.map((d, i) => ({ dia: d, ativos: r[i * 2 + 1] || 0, ...Object.fromEntries(Object.entries(R.hobj(r[i * 2])).map(([k, v]) => [k, Number(v)])) }));
      const n = days.length * 2, top = r[n + 3] || [];
      const C = await codigos(), now = Date.now();
      const pagos = C.filter((c) => c.tipo !== 'teste' && c.plano !== 'dono');
      return send(res, 200, {
        serie, total: r[n], ativos24h: r[n + 1], ativos7d: r[n + 2],
        jogosTop: Array.from({ length: top.length / 2 }, (_, i) => ({ id: top[i * 2], n: Number(top[i * 2 + 1]) })),
        vendas: { n: pagos.length, receita: pagos.reduce((t, c) => t + (Number(c.valor) || 0), 0), ativas: pagos.filter((c) => Number(c.expira) > now).length, porPlano: pagos.reduce((o, c) => ((o[c.plano] = (o[c.plano] || 0) + 1), o), {}) },
        testes: { n: C.filter((c) => c.tipo === 'teste').length, ativos: C.filter((c) => c.tipo === 'teste' && Number(c.expira) > now).length },
      });
    }
    if (q.acao === 'utilizadores') {
      const z = (await R.pipe([['ZREVRANGE', 'users', '0', '499', 'WITHSCORES']]))[0] || [];
      const ids = Array.from({ length: z.length / 2 }, (_, i) => z[i * 2]);
      const h = ids.length ? await R.pipe(ids.map((id) => ['HGETALL', 'u:' + id])) : [];
      return send(res, 200, { utilizadores: ids.map((id, i) => ({ id, ...R.hobj(h[i]) })) });
    }
    if (q.acao === 'utilizador') {
      const id = String(q.id || ''); if (!/^u_[a-z0-9]{8,16}$/.test(id)) return send(res, 400, { erro: 'id inválido' });
      const [h, ev] = await R.pipe([['HGETALL', 'u:' + id], ['LRANGE', 'ev:' + id, '0', '499']]);
      const u = R.hobj(h); let code = null;
      if (u.codigo) code = R.hobj((await R.pipe([['HGETALL', 'code:' + u.codigo]]))[0]);
      return send(res, 200, { id, ...u, codigoInfo: code, eventos: (ev || []).map(J).filter(Boolean) });
    }
    if (q.acao === 'atividade') {
      const f = (await R.pipe([['LRANGE', 'feed', '0', '299']]))[0] || [];
      const L = f.map(J).filter(Boolean), ids = [...new Set(L.map((e) => e.u))];
      const h = ids.length ? await R.pipe(ids.map((id) => ['HMGET', 'u:' + id, 'nome', 'plano', 'plat', 'dono'])) : [];
      const M = Object.fromEntries(ids.map((id, i) => [id, { nome: h[i][0], plano: h[i][1], plat: h[i][2], dono: h[i][3] }]));
      return send(res, 200, { eventos: L.map((e) => ({ ...e, quem: M[e.u] || {} })) });
    }
    if (q.acao === 'codigos') return send(res, 200, { codigos: await codigos() });
    if (q.acao === 'nome' && req.method === 'POST') {
      const b = await body(req), id = String(b.id || ''); if (!/^u_[a-z0-9]{8,16}$/.test(id)) return send(res, 400, { erro: 'id inválido' });
      await R.pipe([['HSET', 'u:' + id, 'nome', String(b.nome || '').slice(0, 60)]]); return send(res, 200, { ok: true });
    }
    return send(res, 400, { erro: 'Ação desconhecida.' });
  } catch (e) { return send(res, 500, { erro: 'Erro no servidor: ' + e.message }); }
};
