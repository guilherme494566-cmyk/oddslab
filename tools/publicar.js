#!/usr/bin/env node
// Uso: node tools/publicar.js <json-completo> [index.html]
// Escreve no index.html só a parte grátis dos dados e guarda o resto cifrado em data/pago.enc.
// Só o servidor (Vercel, com ODDSLAB_PRIVATE_KEY) consegue ler data/pago.enc.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const src = process.argv[2], idx = process.argv[3] || path.join(root, 'index.html');
if (!src) { console.error('Uso: node tools/publicar.js <json-completo> [index.html]'); process.exit(1); }
const full = JSON.parse(fs.readFileSync(src, 'utf8'));
const pub = require('./subconjunto.js').publico(full, Date.now());
// 1) dados públicos no index.html
let html = fs.readFileSync(idx, 'utf8');
const A = '<script type="application/json" id="app-data">', i = html.indexOf(A), j = html.indexOf('</script>', i);
if (i < 0 || j < 0) throw new Error('Bloco app-data não encontrado');
const js = JSON.stringify(pub).replace(/<\//g, '<\\/');
html = html.slice(0, i + A.length) + js + html.slice(j);
fs.writeFileSync(idx, html);
// 2) dados completos cifrados (RSA-OAEP-SHA256 + AES-256-GCM)
const pem = fs.readFileSync(path.join(root, 'data', 'chave-publica.pem'), 'utf8');
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const d = Buffer.concat([c.update(JSON.stringify(full), 'utf8'), c.final()]);
const out = { v: 1, criado: new Date().toISOString(), k: crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), d: d.toString('base64') };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'pago.enc'), JSON.stringify(out));
const nPub = pub.jogos.length, nBl = pub.bloqueados.length;
console.log(`OK: ${nPub} jogos visíveis no plano grátis, ${nBl} bloqueados; data/pago.enc com ${full.jogos.length} jogos.`);
