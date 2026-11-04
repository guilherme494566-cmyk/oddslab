#!/usr/bin/env node
// Modelo Poisson simples: apenas dados observados da football-data.org.
// Não estima cantos, odds de mercado, baixas ou Tip Master sem fontes verificadas.
const fs=require('node:fs');
const key=process.env.FOOTBALL_DATA_KEY;
if(!key || /^sk_(live|test)_/.test(key)) {console.error('FOOTBALL_DATA_KEY ausente ou incompatível. Nada publicado.');process.exit(2);}
const codes=['PPL','PL','PD','SA','BL1','FL1','DED'];
const labels={PPL:['Portugal','Liga Portugal'],PL:['Inglaterra','Premier League'],PD:['Espanha','La Liga'],SA:['Itália','Serie A'],BL1:['Alemanha','Bundesliga'],FL1:['França','Ligue 1'],DED:['Países Baixos','Eredivisie']};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(code){
 const r=await fetch('https://api.football-data.org/v4/competitions/'+code+'/matches',{headers:{'X-Auth-Token':key},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(code+' HTTP '+r.status);
 const { matches, resultSet } = await r.json();
 if (!Array.isArray(matches) || resultSet?.count !== matches.length) throw Error(code+' resposta incompleta');
 const ids = new Set();
 for (const m of matches) {
  if (!Number.isSafeInteger(m?.id) || ids.has(m.id) || !Number.isFinite(Date.parse(m.utcDate))) throw Error(code+' jogo inválido ou duplicado');
  ids.add(m.id);
 }
 return matches;
}
const pois=(k,l)=>Math.exp(-l)*l**k/fact(k);
function fact(n){let a=1;for(let i=2;i<=n;i++)a*=i;return a;}
function predict(h,a){
 const scores=[],p=[0,0,0],dist=[0,0,0,0,0,0];
 for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
 const v=pois(i,h)*pois(j,a);scores.push({r:i+'-'+j,p:v});
 p[i>j?0:i===j?1:2]+=v;dist[Math.min(i+j,5)]+=v;
 }
 const norm=p.reduce((a,b)=>a+b,0);
 return {norm,p:p.map(x=>x/norm),dist:dist.map(x=>x/norm),scores:scores.sort((a,b)=>b.p-a.p).slice(0,5)};
}
function stats(matches,id,side){
 const games=matches.filter(m=>m.status==='FINISHED'&&m.homeTeam?.id&&m.awayTeam?.id&&Number.isInteger(m.score?.fullTime?.home)&&m.score.fullTime.home>=0&&Number.isInteger(m.score.fullTime.away)&&m.score.fullTime.away>=0&&(side==='home'?m.homeTeam.id:m.awayTeam.id)===id).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate)).slice(-12);
 return {n:games.length,for:games.reduce((s,m)=>s+m.score.fullTime[side],0),against:games.reduce((s,m)=>s+m.score.fullTime[side==='home'?'away':'home'],0)};
}
(async()=>{
 fs.rmSync('tmp/oddslab-candidatos.json',{force:true});
 const now=Date.now(),out={atualizado:new Date().toISOString(),jogos:[],historico:[],ligas:{},cantos:{},tenis:{jogos:[],historico:[]}};
 for(const code of codes){
  const matches=await get(code);
  const past=matches.filter(m=>new Date(m.utcDate).getTime()<now&&m.status==='FINISHED');
  const future=matches.filter(m=>m.status==='TIMED'&&new Date(m.utcDate).getTime()>now&&new Date(m.utcDate).getTime()<now+72*3600e3);
  for(const m of future){
   if(!m.homeTeam?.id||!m.awayTeam?.id||!m.homeTeam.name?.trim()||!m.awayTeam.name?.trim())continue;
   const h=stats(past,m.homeTeam.id,'home'),a=stats(past,m.awayTeam.id,'away');
   if(h.n<5||a.n<5)continue;
   const lh=Math.max(.25,Math.min(4,(h.for/h.n+a.against/a.n)/2));
   const la=Math.max(.25,Math.min(4,(a.for/a.n+h.against/h.n)/2));
   const z=predict(lh,la);
   const over15=1-Math.exp(-(lh+la))*(1+lh+la);
   const over25=1-Math.exp(-(lh+la))*(1+lh+la+(lh+la)**2/2);
   const bets=[
    {aposta:'Mais de 1,5 golos',mercado:'Golos',prob:over15,desc:'Estimativa Poisson com resultados observados.'},
    {aposta:'Mais de 2,5 golos',mercado:'Golos',prob:over25,desc:'Estimativa Poisson com resultados observados.'},
    {aposta:'Vitória '+m.homeTeam.name,mercado:'Resultado final',prob:z.p[0],desc:'Probabilidade calculada, sem comparação de odds.'},
    {aposta:'Vitória '+m.awayTeam.name,mercado:'Resultado final',prob:z.p[2],desc:'Probabilidade calculada, sem comparação de odds.'}
   ].sort((x,y)=>y.prob-x.prob);
   bets[0].escolha=true;
   out.jogos.push({id:String(m.id),plano:'free',pais:labels[code][0],liga:labels[code][1],inicio:m.utcDate,casa:m.homeTeam.name,fora:m.awayTeam.name,golosEsperados:[lh,la],prob1x2:z.p,qualidade:'experimental',fonte:'football-data.org; Poisson simples; últimos até 12 jogos casa/fora',contexto:['Amostra casa: '+h.n+' jogos; fora: '+a.n+' jogos','Sem odds verificadas: não é uma recomendação de valor'],apostas:bets,golosDist:z.dist,placares:z.scores.map(s=>({...s,p:s.p/z.norm})),marca:[1-Math.exp(-lh),1-Math.exp(-la)],zeroSofridos:[Math.exp(-la),Math.exp(-lh)],estatisticas:{casa:{j:h.n,gf:h.for,ga:h.against},fora:{j:a.n,gf:a.for,ga:a.against}}});
  }
 if (code !== codes.at(-1)) await sleep(6500); // respeitar limites de pedidos da API gratuita
 }
 fs.mkdirSync('tmp',{recursive:true});
 fs.writeFileSync('tmp/oddslab-candidatos.json',JSON.stringify(out,null,2));
 console.log('Candidatos experimentais:',out.jogos.length,'(sem publicação automática)');

})().catch(e=>{console.error(e.message);process.exitCode=1});
