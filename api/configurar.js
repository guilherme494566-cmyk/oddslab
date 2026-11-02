// Configuração inicial em /admin: guarda a chave privada e a palavra-passe do dono na base de dados.
// Só aceita a chave que corresponde a data/chave-publica.pem, por isso só o dono a consegue configurar.
const R = require('../tools/redis.js');
const CFG = require('../tools/config.js');
const send = (res, c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
async function body(req) { if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; let s = ''; for await (const c of req) { s += c; if (s.length > 20000) break; } return s ? JSON.parse(s) : {}; }
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { erro: 'Usa POST.' });
    if (!R.ok()) return send(res, 503, { erro: 'Falta ligar a base de dados (Upstash Redis) na Vercel.' });
    const b = await body(req), chave = String(b.chave || ''), senha = String(b.senha || '');
    if (senha.length < 6) return send(res, 400, { erro: 'A palavra-passe tem de ter pelo menos 6 caracteres.' });
    if (!CFG.keyMatches(chave)) { await new Promise((r) => setTimeout(r, 800)); return send(res, 400, { erro: 'Esta chave não é a do ODDSLAB. Escolhe o ficheiro ODDSLAB_PRIVATE_KEY.txt ou cola o conteúdo todo, com as linhas BEGIN e END.' }); }
    await CFG.save(chave, senha);
    return send(res, 200, { ok: true });
  } catch (e) { return send(res, 500, { erro: 'Erro no servidor: ' + e.message }); }
};
