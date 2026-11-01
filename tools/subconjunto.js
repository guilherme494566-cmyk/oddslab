// Regras de acesso partilhadas pelo publicador (tools/publicar.js) e pelo servidor (api/acesso.js).
const TZ = 'Europe/Lisbon';
const dia = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const T = (iso) => new Date(iso).getTime();
const pickOf = (g) => (g.apostas || []).find((a) => a.escolha) || (g.apostas || [])[0] || { prob: 0 };
const score = (g) => pickOf(g).prob * (g.qualidade === 'alta' ? 1 : 0.95) * (g.pais === 'Bolívia' ? 0.9 : 1);
const stub = (g) => ({ id: g.id, plano: g.plano, pais: g.pais, liga: g.liga, inicio: g.inicio, casa: g.casa, fora: g.fora, p: Math.round(pickOf(g).prob * 100) / 100, _lock: true });
const tmTeaser = (tm) => (tm ? { data: tm.data, prob: tm.prob, oddMinima: tm.oddMinima, inicio: tm.inicio, preco: tm.preco } : null);

// Jogos grátis: os de plano "free" e as 3 apostas mais fortes de hoje (ou das próximas 72 h).
function gratis(full, now) {
  const ids = new Set(full.jogos.filter((g) => g.plano === 'free').map((g) => g.id));
  const fut = full.jogos.filter((g) => !g.aviso && g.apostas && T(g.inicio) > now);
  const hoje = dia(new Date(now).toISOString());
  const tod = fut.filter((g) => dia(g.inicio) === hoje);
  const pool = tod.length >= 3 ? tod : fut.filter((g) => T(g.inicio) - now < 72 * 3600e3);
  pool.slice().sort((a, b) => score(b) - score(a)).slice(0, 3).forEach((g) => ids.add(g.id));
  return ids;
}
function base(full, now, podeVer) {
  const jogos = [], bloqueados = [];
  full.jogos.forEach((g) => { if (T(g.inicio) <= now || podeVer(g)) jogos.push(g); else bloqueados.push(stub(g)); });
  return { jogos, bloqueados };
}
function publico(full, now) {
  const free = gratis(full, now), { jogos, bloqueados } = base(full, now, (g) => free.has(g.id));
  const ten = full.tenis || {};
  return {
    atualizado: full.atualizado, publico: true, acesso: 'free', jogos, bloqueados,
    historico: full.historico || [], ligas: full.ligas || {}, cantos: full.cantos || {},
    tenis: { atualizado: ten.atualizado, metodo: ten.metodo, jogos: [], historico: ten.historico || [] },
    tenisN: (ten.jogos || []).filter((m) => T(m.inicio) > now - 3 * 3600e3).length,
    tipMaster: tmTeaser(full.tipMaster),
  };
}
function paraPlano(full, plano, now) {
  if (plano === 'elite' || plano === 'dono') return { ...full, acesso: plano, bloqueados: [] };
  if (plano === 'tm') return { ...publico(full, now), acesso: 'tm', tipMaster: full.tipMaster || null };
  // PRO: tudo menos os jogos ELITE, a Tip Master e a comparação de odds
  const { jogos, bloqueados } = base(full, now, (g) => g.plano !== 'elite');
  const ok = new Set(jogos.map((g) => g.id));
  const mApp = (full.multiplasApp || []).filter((m) => (m.pernas || []).every((p) => ok.has(p.jogo) || !full.jogos.some((g) => g.id === p.jogo)));
  const { valor, multiplas, multiplasPendentes, tipMaster, ...rest } = full;
  return { ...rest, acesso: 'pro', jogos, bloqueados, multiplasApp: mApp, tipMaster: tmTeaser(tipMaster) };
}
module.exports = { publico, paraPlano, gratis };
