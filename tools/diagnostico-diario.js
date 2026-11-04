#!/usr/bin/env node
// Diagnóstico não destrutivo. NÃO gera apostas nem publica dados.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const needed = ['index.html', 'tools/publicar.js', 'tools/subconjunto.js', 'data/chave-publica.pem'];
const missing = needed.filter(p => !fs.existsSync(path.join(root,p)));
console.log('OddsLab — diagnóstico diário', new Date().toISOString());
console.log('Ficheiros de publicação:', missing.length ? 'EM FALTA: ' + missing.join(', ') : 'OK');
console.log('Chave football-data.org:', process.env.FOOTBALL_DATA_KEY ? 'configurada' : 'não configurada');
console.log('Publicação desativada até existir gerador validado e esquema JSON confirmado.');
if (missing.length) process.exitCode = 1;
