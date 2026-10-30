// Vercel Serverless Function: jogos das principais ligas (football-data.org, plano grátis)
// A chave fica na variável de ambiente FOOTBALL_DATA_KEY (nunca no site).
const LIGAS = {
  PPL: 'Liga Portugal', PL: 'Premier League', PD: 'La Liga', SA: 'Serie A', BL1: 'Bundesliga',
  FL1: 'Ligue 1', DED: 'Eredivisie', ELC: 'Championship', BSA: 'Brasileirão', CL: 'Liga dos Campeões',
  EC: 'Europeu', WC: 'Mundial',
};
const PAIS = { PPL: 'Portugal', PL: 'Inglaterra', PD: 'Espanha', SA: 'Itália', BL1: 'Alemanha', FL1: 'França', DED: 'Países Baixos', ELC: 'Inglaterra', BSA: 'Brasil', CL: 'Europa', EC: 'Europa', WC: 'Mundo' };
const ymd = (d) => d.toISOString().slice(0, 10);

module.exports = async (req, res) => {
  const key = process.env.FOOTBALL_DATA_KEY;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!key) { res.statusCode = 500; return res.end(JSON.stringify({ erro: 'Falta a chave FOOTBALL_DATA_KEY na Vercel.' })); }
  const de = new Date(Date.now() - 2 * 864e5), ate = new Date(Date.now() + 7 * 864e5);
  try {
    const r = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${ymd(de)}&dateTo=${ymd(ate)}`, { headers: { 'X-Auth-Token': key } });
    if (!r.ok) { res.statusCode = 502; return res.end(JSON.stringify({ erro: 'football-data respondeu ' + r.status })); }
    const j = await r.json();
    const jogos = (j.matches || []).filter((m) => LIGAS[m.competition && m.competition.code]).map((m) => ({
      id: m.id,
      liga: LIGAS[m.competition.code], codigo: m.competition.code, pais: PAIS[m.competition.code],
      inicio: m.utcDate, estado: m.status, jornada: m.matchday || null,
      casa: (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || 'A definir',
      fora: (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || 'A definir',
      golos: m.score && m.score.fullTime && m.score.fullTime.home != null ? [m.score.fullTime.home, m.score.fullTime.away] : null,
    }));
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.statusCode = 200;
    res.end(JSON.stringify({ atualizado: new Date().toISOString(), fonte: 'football-data.org', jogos }));
  } catch (e) {
    res.statusCode = 502; res.end(JSON.stringify({ erro: 'Não foi possível contactar a football-data.org.' }));
  }
};
