# CLAUDE.md — Solarium Mantiqueira (solarium-landing)

Contexto permanente do projeto. Leia antes de qualquer alteração.
Este arquivo existe para você **não precisar perguntar** o que já está aqui.

---

## 1. Projeto

Site de reserva direta do Solarium Mantiqueira: duas casas de temporada em
Itanhandu, MG (Solarium 1, Solarium 2) mais a locação conjunta (Solarium
Completo). Reserva, pagamento e gestão acontecem no próprio site.

Next.js 14 (App Router) · TypeScript · Tailwind · deploy na Vercel (**plano
Pro** — cron de qualquer frequência é permitido).

**Repositório público.** Nada de segredo, chave, token ou dado de hóspede
em código, comentário, teste ou fixture. O que entra no histórico do git
fica lá para sempre, mesmo depois de removido.

**Hostaway** (PMS): conta `123192` · listings Sol1 `316007`,
Sol2 `316005`, Completo `316006`.

## 2. O que é produção

**Produção publica da `main`**, confirmado pela CLI da Vercel. Existem
branches antigas com trabalho não mergeado — antes de assumir que algo
existe, confirme em qual branch está.

| Item | Em produção (`main`) |
|---|---|
| Gateway | **Braspag** (`PAYMENT_PROVIDER=braspag`), 3DS 2.0 + antifraude Cybersource |
| Fallback para Cielo | **Não existe.** Só em branch |
| TTL do draft | 2h normal · **72h** em `aguardando_analise` |
| Purchase GA4/Meta | **Client-side**, na página de confirmação (`TrackPurchase.tsx`), espera `gtag`/`fbq` antes de disparar |
| Analytics na página de pagamento | **Nenhum.** Root layout próprio `(checkout)` (PAG1) |
| CSP | **Report-only, só na página de pagamento** (`src/middleware.ts`, PAG1b). Nada bloqueia, em lugar nenhum |
| Crons | Só `pix-reconcile`, diário |
| `/admin/saude` | **Não existe** |
| Conciliação Hostaway | Só em branch |

**O portal Braspag de produção notifica `/api/webhooks/cielo`**, não
`/api/webhooks/braspag` — resquício da configuração anterior, nunca
atualizado. A reconciliação do antifraude foi instalada nos **dois**
endpoints por causa disso. Não presuma que o webhook Braspag recebe
tráfego real.

## 3. Regras de ouro (nunca violar)

1. **Nunca quebrar a produção.** A Braspag é o provider ativo — não é
   código atrás de flag desligada.
2. **Não alterar nada sob `/reservar/[draftId]/pagamento`** sem instrução
   explícita na rodada. Inclui layout, CSP, 3DS e fingerprint. A rota vive
   no route group `src/app/(checkout)`, com **root layout próprio e sem
   analytics** (PAG1): o Next faz carga completa ao cruzar root layouts, então
   GA4/Meta de outras páginas não chegam ao pagamento. O resto do site está em
   `src/app/(site)`. Não adicione script de terceiro nem `next/script` à árvore
   `(checkout)` — o teste `isolamento-pagamento.test.ts` barra. Único script
   de terceiro permitido: ThreatMetrix (e o SDK 3DS, self-hosted).
3. **Não alterar `src/lib/cielo`** sem instrução explícita.
4. **Recálculo de preço SEMPRE server-side.** Âncora honesta, sem inflar
   valor.
5. **Credenciais só em env vars.** Nunca hardcode, nunca em query string.
6. **Não alterar os valores dourados de pacote** nos testes:
   R$ 3.460 / R$ 3.740 / R$ 5.990 / R$ 6.340. Se um quebrar, o bug é seu.
7. Extras de serviço aparecem **sem o símbolo "R$"** nos itens de linha;
   total e botão de pagar com "R$" completo.
8. **Cupom não combina com pacote.**
9. Testar em branch de preview antes do merge. Nunca commitar direto na
   `main` sem pedir. Nunca `git push --force`, `git rebase` em branch
   compartilhada ou `git reset --hard`.
10. **Não criar rota de debug ou admin sem autenticação real.** O
    repositório é público; chave em código ou em querystring não é proteção.
11. Nada de `localStorage`/`sessionStorage` para estado de reserva.
12. Todo dado persistido em log ou registro operacional passa por redação:
    nunca PAN, CVV, nome completo, e-mail ou CPF.

## 4. Pagamento — Braspag

- `api.braspag.com.br`. MerchantId
  `D01A28D5-EA80-4C4D-A042-BA1E6FF4FA72`. MCC `7011`.
- **Captura separada**: autoriza → antifraude → `PUT
  /v2/sales/{PaymentId}/capture` disparado pelo nosso código.
  Não usar `Capture:true` fora de smoke test.
- Hostaway e purchase estão acoplados à **captura**, não à autorização.
- Env vars: `BRASPAG_ENVIRONMENT`, `BRASPAG_MERCHANT_ID`,
  `BRASPAG_MERCHANT_KEY`, `BRASPAG_3DS_CLIENT_ID`,
  `BRASPAG_3DS_CLIENT_SECRET`, `BRASPAG_AF_PROVIDER_MERCHANT_ID`,
  `PAYMENT_PROVIDER`, `ADMIN_API_TOKEN`,
  `ANTIFRAUDE_REVIEW_ENABLED`, `EMAIL_REMETENTE_HOSPEDE`.
  Valores nunca neste arquivo.
- **Todo campo de texto enviado à Braspag passa pela função de ajuste de
  limites** — `ajustarLimitesBraspag`, em `src/lib/braspag-limites.ts`,
  chamada num ponto só, no início de `createBraspagAuthorization`. Campo acima
  do tamanho documentado faz a análise de risco responder 400 e a transação
  voltar `Aborted`, sem motivo legível do nosso lado (foi a causa dos dois
  casos de 22/09: `Complement` com 16 onde cabem 14). Ao acrescentar um campo
  ao corpo, adicione o limite em `LIMITES_BRASPAG`, passe o campo pela função
  e registre na tabela do `DECISOES.md` — há teste que falha se um campo entrar
  na tabela sem caso de limite. A função é pura: o ajuste vale só para o que
  vai à Braspag, nunca para o rascunho nem para o Hostaway.

### Antifraude Cybersource — fluxo de Review (implementado)

`FraudAnalysis.Status` é **numérico**:

```
0 = Unknown · 1 = Accept · 2 = Reject · 3 = Review
4 = Aborted · 5 = Unfinished
```

O valor pode chegar como número ou como texto. Sempre normalize antes de
comparar — há função dedicada para isso.

**Com `ANTIFRAUDE_REVIEW_ENABLED` ligada**, um `Review` (3):
não dá void, não captura, não cria reserva; marca o draft como
`aguardando_analise`, bloqueia as noites no Hostaway, estende o TTL para
72h, avisa o hóspede por e-mail e por tela. A decisão chega por notificação
e é resolvida por reconciliação.

**Decisão × falha técnica (AF2).** `Accept` (1), `Reject` (2) e `Review` (3)
são decisões: a análise rodou e julgou. `Unknown` (0), `Aborted` (4) e
`Unfinished` (5) significam que a análise **não foi executada** — não são
recusa e nunca podem virar uma. Com a flag ligada e o pagamento **autorizado**
(`Payment.Status` 1), falha técnica segue o mesmo caminho do Review
(`aguardando_analise`, noites seguradas, TTL de 72h), com
`analise.motivo = "falha-tecnica"`. A diferença: **nenhuma notificação vai
chegar** — só sai daí por decisão humana (capturar/cancelar no portal e depois
`POST /api/admin/antifraude`). O alerta interno desse caso é de ação
necessária. Pagamento não autorizado: comportamento inalterado.
Helpers: `ehFalhaTecnicaAntifraude` / `ehDecisaoAntifraude`.

**Com a flag desligada**, comportamento antigo: void em Review e em falha
técnica.

Confirmado com a Braspag/Cielo (set/2026):
- Em Review a transação permanece **autorizada e não capturada**.
- A decisão chega por **notificação automática**, na URL já configurada.
- **Qual `ChangeType` carrega a decisão não está documentado** e a Braspag
  não soube informar. Por isso a reconciliação **não usa `ChangeType` como
  gatilho**: consulta `GET /v2/sales/{PaymentId}` e decide pelo estado real.
  Não reintroduza dependência de `ChangeType`.
- Em Reject o cancelamento da autorização é **automático** do gateway.
  Não enviar cancelamento.
- Não há prazo garantido de validade da autorização não capturada. Falha de
  captura pós-Accept é cenário real e precisa de retry com alerta.
- **Não existe forma de forçar uma transação a cair em Review.** A revisão
  é automatizada pela Cybersource/Braspag, não manual do nosso lado.

**Mensagem ao hóspede nunca culpa o emissor pelo que não foi dele** (AF2):
só recusa que veio do emissor (HTTP 2xx com `ReturnCode` de negativa) usa
`mensagemRecusaBraspag`. Erro de requisição, decisão do antifraude e falha de
captura usam texto neutro (`MENSAGEM_FALHA_TECNICA_PAGAMENTO`).

Reconciliação manual: `POST /api/admin/antifraude` com
`{ "paymentId": "..." }`, autenticado por `Authorization: Bearer`.
Leitura: `GET` na mesma rota. O `GET` traz `emAnalise.review` e
`emAnalise.falhaTecnica` separados — o segundo é fila de trabalho humano.

### Device fingerprint Cybersource (ThreatMetrix) — FP1

- Script `https://h.online-metrix.net/fp/tags.js?org_id=…&session_id=…` +
  noscript com iframe, carregados pelo `layout.tsx` da rota de pagamento
  (`FingerprintCybersource.tsx`), só com `PAYMENT_PROVIDER=braspag`.
- **org_id deriva de `BRASPAG_ENVIRONMENT`**: `production` → `k8vif92e`,
  resto → `1snn5n9w`. Segue o ambiente Braspag, não o da Vercel.
- `session_id` = ProviderMerchantId + ProviderIdentifier, sem separador.
  ProviderMerchantId (formato `braspag_nomedaloja`, **≠ MerchantId**) vem de
  `BRASPAG_AF_PROVIDER_MERCHANT_ID`. Vazia = sem script e sem campo.
- ProviderIdentifier: GUID de 32 hex gerado no servidor por carregamento, um
  por janela (o `tags.js` não roda duas vezes). Vai em
  `Payment.FraudAnalysis.FingerPrintId` e fica em `draft.fingerprintId` e no
  authlog.
- **O fingerprint nunca bloqueia a compra**: ausente ou inválido, a
  autorização segue sem o campo.
- Allowlist de CSP apurada: DECISOES.md, rodada FP1.

## 5. Vocabulário de marca (todo texto visível ao hóspede)

**Proibido:** luxo · exclusivo · premium · sofisticado · investimento (para
diárias) · experiência única · momentos inesquecíveis · o lugar perfeito ·
chalé · pousada · amenidades · unidade

É sempre **casa**. Nunca chalé, nunca pousada. Linguagem de casa e
curadoria, nunca de hotel.

Em estado de pagamento pendente, **nunca** usar com o hóspede: "avaliação",
"análise", "risco", "antifraude", "pendente", "em processamento",
"verificação". Nunca escrever "reserva confirmada" ou "pagamento aprovado"
nesse estado. Dizer que o pagamento foi autorizado e a confirmação está
sendo finalizada.

Existe `scripts/lint-copy.mjs`, executado no build, que barra palavra
proibida em copy nova.

Assinatura verbal: *"Não é só ficar. É pertencer."*

Logo: mínimo 120px de largura no digital. Nunca alterar cor, girar,
deformar ou aplicar sombra.

## 6. Imagens: fotos no Supabase, vídeos no Cloudinary

**Fotos** vêm do **Supabase Storage**, bucket público `galerias` (projeto da
Fernanda). A origem é a pasta "site" do Drive; os originais em alta ficam lá.

```
galerias/solarium-1/{ambiente}/{slug}.jpg
galerias/solarium-2/{ambiente}/{slug}.jpg
galerias/completo/{slug}.jpg
galerias/experiencias/{slug}.jpg
galerias/comum/marca/logo-{branco,preto}.png
```

- **Fonte única: os manifestos** `content/galerias/*.json`, gerados por
  `npm run galerias:preparar` (IMG-0) — **nunca editados à mão**. O que é
  julgamento humano (alt, estação, ordem, capa, exclusões) mora em
  `content/galerias/curadoria.json`, chaveado pelo SHA-256 do original.
- Nenhum componente monta URL de foto na mão: `urlGaleria()` em
  `src/lib/galerias/url.ts`. Páginas usam `carregarGaleria`,
  `montarGaleriaDaCasa`, `destaque` etc. de `@/lib/galerias`.
- **`podeSerVitrine()`** decide capa, hero, mosaico, Google, og e JSON-LD:
  nunca foto com `marcaDagua`, `telaComConteudo`, `baixaResolucao` ou
  `excluirDoSite`. `excluirDoSite` nunca aparece; `creditoPendente` só com
  `credito` preenchido.
- Nome de arquivo é slug estável; a ordem fica só no campo `ordem`.
- **As pastas de `galerias-local/` decidem ambiente e presença** (um chip por
  pasta, "Todas" antes; foto em várias pastas aparece em cada chip). Guia do
  Lucas no topo do `DECISOES.md`: mover de pasta, `_fora` para tirar, "01 "
  no nome para ordenar, e pedir **"atualize as galerias"** =
  `npm run galerias:atualizar` (preparo, upload só do novo, folha, testes).
- Caminho no bucket congelado em `content/galerias/caminhos.json`; o que já
  subiu fica em `enviados.json` (SHA-256). Quase-duplicatas confirmadas em
  `quase-duplicatas.json`. Hero e mosaico nunca repetem.
- Subir: `npm run galerias:subir` (API REST do Storage; precisa de
  `SUPABASE_SERVICE_ROLE_KEY`, que só existe em `scripts/`).
- `NEXT_PUBLIC_SUPABASE_URL` é obrigatória no build (o `next.config` falha
  sem ela) — `.env.local` e Vercel (Production e Preview).

**Vídeos** continuam no **Cloudinary** (cloud name `dmfoddfz3`), via
`src/lib/cloudinary.ts` (`videoUrl`, `videoPosterUrl`).

`public/images/` ainda tem fotos antigas em uso fora das casas (home,
pacotes, experiências, reserva); saem na IMG-1b/1c. Logos continuam locais.

## 7. Arquivos-chave

- `src/config/` — coupons, properties, packages, service-extras,
  operational-extras, payment-provider, **flags**
- `src/lib/` — braspag, cielo, cloudinary (vídeos), **galerias** (fotos), hostaway
  (`createHostawayReservation`, `blockCalendarNight`,
  `unblockCalendarNight`, `calculatePriceDetailed`), kv-store, email,
  **comunicacao-analise**, **reconciliacao-analise**, cn
- `src/app/(site)/` — páginas do site (root layout com GA4 e Meta); `src/app/(checkout)/` —
  pagamento e `braspag-3ds-test` (root layout sem analytics)
- `src/app/api/` — payments/braspag/*, payments/credit, payments/pix,
  reservations/draft, availability/check, extras/check, webhooks/cielo,
  webhooks/braspag, admin/antifraude, **csp-report** (violações CSP, público,
  sempre 204), **admin/csp** (leitura, Bearer), debug/*
- `src/middleware.ts` + `src/lib/csp.ts` — CSP report-only da página de
  pagamento, com nonce
- `content/galerias/` — manifestos de galeria (gerados)
- `scripts/` — preparar-galerias, subir-galerias, gerar-og, lint-copy

## 8. Comandos

```bash
npm run dev
npm test                 # suíte completa — antes de qualquer PR
npm run build            # precisa passar limpo
npx tsc --noEmit         # precisa passar limpo
npm run galerias:preparar  # fotos de galerias-local/ → galerias-processadas/ + manifestos
npm run galerias:subir     # sobe galerias-processadas/ para o Supabase (--dry-run antes)
npm run galerias:folha     # folha de contato local (pastas, chips, quase-duplicatas)
npm run galerias:atualizar # "atualize as galerias": preparo + upload do novo + folha + testes
```

Durante `next build`, `[Hostaway] Falha ao gerar token: 401` é **esperado**
— o ambiente de build não tem credenciais reais. Não é regressão.

**Não existe ESLint configurado.**

## 9. Estilo de trabalho

- Decisões diretas, flags de risco proativas, sem floreio. Prompts em
  português.
- O trabalho anda em **rodadas nomeadas** com escopo fechado.
  Uma rodada = **um entregável**. Passando de ~8 arquivos, pare e proponha
  dividir **antes** de escrever código.
- Instrução padrão: **"NÃO PERGUNTE — DECIDA E SIGA."** Havendo tradeoff
  sem resposta óbvia, escolha, siga, e registre escolha e motivo em
  `DECISOES.md`. Exceção: se a **branch de base** não estiver clara, pare e
  pergunte.
- **Não expanda escopo.** Achado fora do escopo vai para `DECISOES.md` sob
  "Achados fora de escopo", sem correção.
- Teste existente que quebra significa código errado. Só altere o teste com
  justificativa escrita no PR.
- Quando a rodada não pode mudar comportamento, prove com teste de
  equivalência — não com argumento.
- Não gerar corpo de PR em `docs/pr/`. Abrir o PR direto com `gh`.

## 10. Estado conhecido (atualizar quando mudar)

**Segurança — prioridade**
- 🚨 Quatro rotas `/api/debug/*` (`channels`, `hostaway-reservation`,
  `price-test`, `regenerate-token`) em produção, protegidas por chave
  escrita no código, em repositório público. A chave está no histórico do
  git e **precisa ser rotacionada**, não só removida. Rodada S1 pendente.
- `/api/payments/braspag/authlog` recebe o segredo por query string.

**Antifraude — pendências antes de ligar a flag**
- Rotas de Pix e do fallback Cielo **não barram no servidor** um draft em
  `aguardando_analise`. Só a tela protege. Chamada direta geraria cobrança
  duplicada. Rodada AF1 pendente.
- E-mail ao hóspede não chega: remetente ainda é `onboarding@resend.dev`.
  Verificar domínio no Resend e criar `EMAIL_REMETENTE_HOSPEDE`.
- Cron de segurança para pagamentos presos há mais de 6h em
  `aguardando_analise` — pendente. O plano Pro permite qualquer frequência.
- A captura de webhooks não tratados da A1 só olha o endpoint Braspag, que
  não recebe tráfego real. Contagem por `ChangeType` fica zerada.

**Dívidas registradas**
- Criação de reserva após Accept duplica parâmetros do fluxo direto —
  campo novo precisa entrar nos dois lugares. Refatorar na triagem.
- Purchase é client-side: uma venda aprovada após Review **não gera evento
  de purchase**, porque o hóspede já saiu da página. Resolver junto com a
  migração para server-side que existe em branch.
- Webhook com corpo JSON `null` responde 500.
- Webhook com `ChangeType: "1"` em texto é ignorado — perderia confirmação
  de Pix.
- Conciliação Hostaway retornando 401 — só existe em branch.
- CSP em report-only na página de pagamento (PAG1b). Antes de qualquer
  modo bloqueante, ler `/api/admin/csp` em produção: o ACS dos bancos
  emissores (challenge do 3DS) não está na allowlist, de propósito.

**Branches**
- **24+ commits de pagamento não mergeados** em
  `fix/observabilidade-e-conciliacao`, `feat/fallback-braspag-cielo` e
  `feat/galeria-cloudinary` (que herdou os anteriores). Precisa de rodada
  de triagem.
- 🚨 O fallback para Cielo dispara em `fraudStatus !== 1`, o que inclui
  `Reject` (2) e `Review` (3) — reenvia para um gateway sem Cybersource uma
  transação que o Cybersource recusou. **Rota de contorno do antifraude.**
  Antes de qualquer merge, precisa distinguir falha técnica (`Unknown`,
  `Aborted`, `Unfinished`) de decisão (`Reject`, `Review`).

**Galeria**
- IMG-1a: páginas das casas com hero pela capa do manifesto, mosaico e grade
  por ambiente com lightbox; nenhuma foto repetida no DOM. IMG-1b (home,
  pacotes, experiências) e IMG-1c (og, sitemap de imagens, limpeza de
  `public/images/`) pendentes.
- `feat/galeria-cloudinary` (Rodada 1, Cloudinary) foi substituída pela
  IMG-0/IMG-1 e não deve ser mergeada.
