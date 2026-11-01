# ODDSLAB

App pessoal de prognósticos de futebol (página estática, um só ficheiro).

- `index.html` — a aplicação inteira (HTML, CSS, JS e dados do dia).
- `vercel.json` — configuração do Vercel (sem cache, para os dados novos aparecerem logo).

## Publicar no Vercel
1. Envia esta pasta para um repositório no GitHub.
2. Em vercel.com → Add New → Project → importa o repositório.
3. Framework: **Other**. Sem comando de build. Output: a raiz.
4. Deploy. Cada novo envio para o GitHub atualiza o site automaticamente.

Probabilidades estimadas, não certezas. 18+

## Acesso pago (desde 01/11/2026)
- `index.html` tem só os dados grátis. Os dados completos ficam cifrados em `data/pago.enc`.
- Todos os dias: `node tools/publicar.js <json-completo>` atualiza o `index.html` (parte grátis) e o `data/pago.enc`.
- `api/acesso.js` confirma o código do cliente e devolve os dados do plano (PRO, ELITE ou Tip Master).
- `/admin` cria códigos de acesso (precisa da palavra-passe de administrador).
- Variáveis na Vercel: `ODDSLAB_PRIVATE_KEY` (chave privada PEM) e `ODDSLAB_ADMIN` (palavra-passe do dono).
- `data/chave-publica.pem` é pública e só serve para cifrar.

## Painel do dono e registos (desde 01/11/2026)
- `/admin`: resumo, utilizadores (o que cada um viu e copiou), vendas (códigos, clientes, valor), atividade em direto e criação de códigos.
- `api/evento.js` recebe a atividade anónima da app; `api/admin.js` serve o painel.
- Precisa de uma base Upstash Redis ligada ao projeto na Vercel (Storage → Upstash for Redis), que cria `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
- Plano "Dono": código de acesso total, mostra o botão 👑 Painel na app e não conta nas estatísticas.
