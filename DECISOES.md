# DECISÕES

Registro técnico do que está ativo e onde. Fato, não justificativa.

Última correção da arquitetura de tracking: **25/08/2026** — usar esta data para
marcar o antes/depois nos relatórios.

## Tracking

### Carregamento de tags

| O quê | Valor | Onde |
| --- | --- | --- |
| Container GTM | `GTM-MRV2KVJF` | `src/lib/analytics/AnalyticsScripts.tsx` |
| Propriedade GA4 do funil | `G-6LG42C5DDM` | configurada **no GTM**, não no código |
| Meta Pixel | `1029814882379214` | tag no GTM; o id também vive em `META_PIXEL_ID` para o CAPI |
| Google Ads | `AW-11360688087` | tag no GTM |
| GA4 do motor de reservas | `G-9J8F6Q1Y2M` | **removido do código.** Mede o motor de reservas, não o site |

O GTM é o **único** carregador de tag de navegador. Não há `gtag.js`, snippet de
Meta Pixel nem inicialização de Google Ads no código — trocar ou pausar uma tag
é mudança no GTM, sem deploy. O smoke falha o build se `G-9J8F6Q1Y2M`, `gtag(`
ou `fbq(` reaparecerem.

O container só carrega quando `VERCEL_ENV === "production"` (`analyticsAtivo()`
em `src/config/flags.ts`): preview não emite medição.

### O GTM não é validável em preview

A restrição acima é **decisão de projeto, não defeito**. Tráfego de preview —
build de teste, reserva forjada, clique de quem está conferindo layout — entraria
na mesma propriedade que o tráfego real e contaminaria a base do experimento.
Um deployment de preview com zero requisições a `googletagmanager.com` está
correto.

A consequência é que a conferência do container (Tag Assistant, `page_view`
chegando em `G-6LG42C5DDM`) **só acontece em produção**. Isso junta a validação
do GTM à do 3DS da Braspag, que já tinha exatamente a mesma restrição por outro
motivo — o MPI só autentica no domínio de produção. As duas verificações caem na
mesma janela de deploy.

O smoke cobre a parte estática dessa lacuna: falha o build se o layout do site
deixar de importar ou renderizar `AnalyticsScripts`, se `GTM_ID` sumir ou mudar
de valor, ou se o snippet parar de carregar o `gtm.js`. O que ele **não** cobre é
a tag chegando ao navegador — isso continua sendo verificação humana em produção.

### A flag é congelada no build para páginas estáticas

A home é prerenderizada (`○ Static`), então `analyticsAtivo()` é avaliada **no
momento do build**, não a cada requisição. Trocar `VERCEL_ENV` (ou qualquer
variável que a alimente) sem **rebuildar** não muda o comportamento dela.

Isso produz um sintoma que engana: no mesmo deployment, uma rota dinâmica como
`/reservar` pode mostrar o GTM enquanto a home não mostra. Ao conferir, teste a
home — é ela que reflete o estado do build.

Vale para qualquer variável de ambiente lida em página estática: alterar o valor
no painel da Vercel exige redeploy para ter efeito.

### Onde o GTM NÃO carrega

Rotas que renderizam campos `bpmpi_*` do 3DS (dados de cartão no DOM):

- `/reservar/[draftId]/pagamento`
- `/braspag-3ds-test`

A exclusão é **estrutural**, não checagem de rota em runtime. O App Router tem
dois layouts raiz:

- `src/app/(site)/layout.tsx` — carrega o GTM;
- `src/app/(checkout)/layout.tsx` — não tem como herdá-lo.

A entrada na rota de pagamento é navegação **dura** (`window.location.assign` no
`GuestForm`): num `router.push` o documento seria o da página anterior, com os
scripts que ela já carregou e a CSP que ela já recebeu.

GTM aparecendo no checkout se corrige **no layout**, nunca afrouxando a CSP. O
smoke falha o build se a política ganhar domínio de tag manager ou analytics.

### Identificador canônico de conversão

O **número da reserva no Hostaway**. É o `transaction_id` do GA4 e o `event_id`
do Meta.

Antes de a reserva existir, `begin_checkout` carrega um id da tentativa de
checkout (`src/lib/analytics/checkout-id.ts`), aberto no clique do CTA e gravado
no draft — é o que liga a intenção medida à reserva que saiu dela.

### Eventos no `dataLayer`

Empurrados por `src/lib/analytics/dataLayer.ts`. Nenhuma função desse módulo
dispara pixel ou gtag.

| Evento | Função | Disparado em | Parâmetros |
| --- | --- | --- | --- |
| `view_item` | `pushViewItem` | página da casa | `value`, `currency`, `items[]` |
| `view_item` | `pushViewPackage` | página do pacote, com preço real | idem + `item_category: 'pacote'` |
| `begin_checkout` | `pushBeginCheckout` | **clique** do CTA "Reservar" | `transaction_id`, `value`, `currency`, `items[]`, `payment_method` |
| `generate_lead` | `pushGenerateLead` | primeiro clique em WhatsApp da sessão | `lead_source` |
| `whatsapp_click` | `pushWhatsAppClick` | todo clique em WhatsApp | `origem` |

`view_item` **não** carrega `transaction_id`: nessa etapa não existe reserva nem
draft, e o campo é omitido em vez de ir vazio.

Nenhum evento com `value` é empurrado quando o preço não veio da Hostaway —
`precoUtilizavel()` derruba o push inteiro.

Guarda de idempotência por sessão (`sessionStorage`, escopo de aba) só em
`begin_checkout` e `generate_lead`. Visualização e clique em WhatsApp repetidos
são eventos legítimos.

Os eventos de produto do experimento de pacotes (`pacote_visualizado`,
`extra_selecionado`, `pacote_cta_reserva`, …) ficam em
`src/lib/analytics/tracking.ts` e também empurram para o `dataLayer`.

### Mapeamento do funil

| Etapa | Evento |
| --- | --- |
| Página da casa / do pacote | `view_item` |
| Clique no CTA "Reservar" | `begin_checkout` |
| `/reservar` | nenhum evento de conversão |
| `/reservar/{id}/pagamento` | nenhum evento; sem GTM |
| `/reservar/{id}/confirmacao` | **nenhum evento** |

### Quem dispara Purchase

**Somente o servidor**, por um **módulo único**: `enviarConversaoReserva()` em
`src/lib/analytics/server-conversions.ts`.

O disparo já morou dentro de `/api/payments/braspag/credit`. A rota Cielo
(`/api/payments/credit`), que é o caminho de produção, nunca recebeu a
instrumentação — reserva 65375857 foi criada, o cliente foi cobrado, e nenhuma
conversão saiu. Enquanto o disparo for código dentro de uma rota, a próxima rota
de pagamento nasce com o mesmo buraco. Por isso ele virou função, e o smoke
reprova o build se algum arquivo chamar `createHostawayReservation` sem chamar
`enviarConversaoReserva`.

Os quatro caminhos que criam reserva, todos ligados ao módulo:

| Caminho | Arquivo |
| --- | --- |
| Cartão Cielo | `src/app/api/payments/credit/route.ts` |
| Cartão Braspag | `src/app/api/payments/braspag/credit/route.ts` |
| Pix Braspag | `src/lib/braspag-pix-confirm.ts` |
| Pix Cielo (polling) | `src/app/api/payments/pix/status/route.ts` |
| Webhook Cielo | `src/app/api/webhooks/cielo/route.ts` |

### Prazos de retroação

| Destino | Janela | Campo |
| --- | --- | --- |
| GA4 Measurement Protocol | **72 horas** | `timestamp_micros` |
| Meta CAPI | **7 dias** | `event_time` |

Passada a janela, o GA4 aceita o evento com 204 e o descarta em silêncio. O
script `scripts/recuperar-conversao.mjs` calcula o tempo decorrido e recusa o
envio fora do prazo, em vez de fingir sucesso.

### O 204 do GA4 não prova nada

Medido: `/mp/collect` responde **204 para tudo** — measurement id inexistente,
api_secret errado, corpo sem evento nenhum. O status HTTP do envio não distingue
evento contabilizado de evento descartado.

Por isso todo envio é seguido de uma checagem em `/debug/mp/collect`, que roda a
mesma validação e **devolve** os problemas. É o log `[Conversao:GA4] validacao`
que diz se o evento vale; `[Conversao:GA4] purchase enviado` diz apenas que a
requisição foi aceita na porta.

Idempotência em duas camadas:

- `webhook_events` (`payment_id` + `change_type`, TTL 30 dias) — barra a
  reentrega dentro da janela;
- `conversions_sent` (`transaction_id` + destino, **TTL 24 meses**) — barra a
  reentrega tardia e o reprocessamento manual, que escapam da primeira.

Falha de envio (rede, token, 4xx) é engolida com log `error`: analytics não
derruba reserva paga, e o gateway recebe resposta normal.

`client_id`/`session_id` do GA (cookies `_ga` e `_ga_*`), `_fbp`/`_fbc` do Meta,
`gclid` e `utm_*` são capturados **antes** da navegação dura e gravados no draft
— no envio server-side o navegador do hóspede já não existe. Qualquer um deles
ausente persiste como indefinido e nunca bloqueia a criação do draft.

### Política de CSP

Aplicada **só** às rotas do grupo `(checkout)` (`src/middleware.ts`). O resto do
site não recebe CSP nesta rodada.

**Modo atual: `report-only`** — o padrão quando `CSP_MODE` está ausente.

O 3DS da Braspag **não é testável em preview**: a autenticação bloqueia domínios
diferentes do de produção. A política nunca pôde ser exercitada antes do deploy,
e uma lista de origens escrita às cegas aplicada em bloqueio recusa cartão
legítimo. Por isso:

- `CSP_MODE=report-only` emite `Content-Security-Policy-Report-Only`;
- `CSP_MODE=enforce` emite `Content-Security-Policy`;
- a política é a mesma nos dois modos — muda só qual header a carrega;
- alternar é mudança de variável na Vercel, **sem deploy de código**, e a
  reversão é a mesma variável de volta.

Origens declaradas hoje: `'self'`, `mpi(sandbox).braspag.com.br` e
`h.online-metrix.net` (fingerprint do antifraude Cybersource); `connect-src`
inclui ainda `viacep.com.br`. **A lista definitiva sai dos relatórios de violação
colhidos em produção**, não de suposição.

`frame-src` e `form-action` permanecem permissivos: o challenge 3DS abre e
submete para o ACS do banco emissor, cujo domínio varia por emissor e não é
enumerável. Fechar essa lista reprovaria cartões de bancos legítimos.

Violações chegam em `POST /api/csp-report` (sem autenticação — quem posta é o
navegador; defesa por limite de corpo e deduplicação) e são persistidas em
`csp_violations`, deduplicadas por `blocked_uri` + `violated_directive` com
contador. Leitura: `GET /api/admin/diagnostico`, protegido por `ADMIN_API_TOKEN`.

### Rollout da CSP

1. **Deploy com `CSP_MODE=report-only`** e uma reserva real de valor baixo, ponta
   a ponta.
2. **Observação** — mínimo de 7 dias ou 20 pagamentos, o que vier depois. Cada
   violação registrada é uma origem legítima que faltou: acrescentar à política,
   nunca bloquear. Repetir até a janela fechar sem violação nova.
3. **Promoção** — só então `CSP_MODE=enforce`, com nova reserva real de teste
   logo em seguida.

## Proteção do botão de pagamento

Toda ramificação de erro do fluxo Braspag libera o botão:

- o handler inteiro está sob `try/finally`, e o `finally` é o único ponto que
  chama `setCardProcessing(false)`;
- a espera pelo callback do 3DS tem prazo (`TIMEOUT_3DS_MS`, 5 min). Sem ele, uma
  SDK que nunca responde — script barrado, rede caída — deixava a promessa
  pendente e o botão travado para sempre;
- depois de um 3DS malsucedido, `reinit3ds` força o efeito de init a rodar de
  novo. Zerar o ref e chamar `setBraspagReady(false)` não reexecutava o efeito
  (ref não é dependência), e a sessão nunca era recriada.

## Marcação de pagamento na Hostaway

Criar a reserva e registrar o pagamento nela são coisas separadas, e a Hostaway
tem lag entre aceitar uma e aceitar a outra. Tentar marcar na hora falha quase
sempre; segurar a resposta esperando o lag passar é pior, com o cliente na tela
de pagamento. Então a marcação é **enfileirada**.

- Fila: `hostaway_pending_finalization` no KV, chaveada por `reservation_id`
  (enfileirar a mesma reserva duas vezes não cria duas entradas).
- Método: `credit_card_offline` para cartão, `bank_transfer` para Pix.
- Dreno: `GET /api/hostaway/finalizar-pagamentos`, por cron.
- Backoff: 5, 15, 30, 60, 60, 60 minutos. Após 6 tentativas, a entrada é marcada
  `escalado`, sai da rotação e aparece em `/api/admin/diagnostico`.
- Idempotência: antes de registrar, consulta as cobranças já existentes na
  reserva. Se a consulta falhar, **não registra** — cobrança duplicada na
  contabilidade exige estorno e conversa com o hóspede; marcação pendente só
  espera.

**Cadência do cron.** O plano Hobby da Vercel só aceita cron diário: um
`*/5 * * * *` no `vercel.json` faz a Vercel **rejeitar o deployment em
silêncio**. O cron está em `15 6 * * *`. Para rodar a cada 5 minutos, ou migrar
para o plano Pro e trocar a expressão, ou apontar um agendador externo para o
endpoint com `HOSTAWAY_FINALIZE_SECRET`.

**Endpoint não exercitado.** `POST /v1/reservations/{id}/offlineCharges` vem da
documentação pública; o schema completo do corpo não é publicado. A resposta
crua é sempre logada em `[Hostaway:pagamento]`, com status e corpo — a primeira
execução em produção revela o contrato real, sem adivinhação.

## Decomposição financeira da reserva

`src/lib/hostaway-financeiro.ts` monta extras e descontos como linhas
(`reservationFees`) a partir do draft.

**Regra inegociável:** a soma das linhas tem que fechar ao centavo com o valor
cobrado. Divergência não é arredondada — a decomposição é descartada, o caso vai
para `[Hostaway:financeiro]` em nível `error`, e a reserva segue com
`totalPrice`, que é o comportamento que já funciona. Um orçamento que não fecha
é pior que um orçamento ausente: ele parece certo.

O envio nasce atrás de `HOSTAWAY_ENVIAR_DECOMPOSICAO`, **desligada**. Sem poder
exercitar o schema contra a conta real, ligar por padrão arriscaria a criação da
reserva inteira. Com a flag desligada o cálculo roda e é logado, sem alterar
nada.

## TTL do draft: 2 horas é curto demais

Os identificadores de atribuição (`gaClientId`, `gaSessionId`, `_fbp`, `_fbc`,
`gclid`, `utm_*`) vivem no draft e **morrem com ele**. O TTL é de 2 horas.

Um checkout com várias tentativas de cartão — recusa, troca de cartão, 3DS que
falha e obriga a recomeçar — passa fácil de duas horas. Quando isso acontece, a
conversão pode até ser enviada, mas entra sem origem: aparece como tráfego
direto, e a campanha que trouxe o hóspede não recebe crédito nenhum.

Foi o que aconteceu com a reserva 65375857. O draft `861734d3-…` já havia
expirado quando a recuperação foi tentada, e todos os identificadores estavam
perdidos em definitivo.

**Avaliar aumentar para 24 horas numa rodada futura.** O custo é chave a mais no
Redis por 22 horas; o benefício é atribuição que sobrevive a um checkout difícil.

### O que sobrevive: os dados da reserva

A reserva na Hostaway guarda e-mail, telefone e nome do hóspede depois que o
draft evapora. O Meta CAPI aceita esses campos como parâmetros de
correspondência, com SHA-256 e normalização (minúsculas, sem espaços; telefone
só dígitos com código do país). Não substitui `_fbp`/`_fbc`, mas recupera boa
parte da atribuição — e é o que `scripts/recuperar-conversao.mjs` usa.

O GA4 não tem equivalente: sem `client_id` real, só resta um identificador
sintético, que conta a receita mas cria um usuário fantasma e atribui a compra à
origem direta. Por ser um trade-off e não um detalhe técnico, o script só faz
isso com `--ga4-sintetico` explícito.

## Marcação de pagamento: duas camadas

O cron sozinho não resolve o problema real — o hóspede abre o portal minutos
depois de reservar e vê "não pago". Mesmo a cada 5 minutos haveria janela.

**Camada 1, imediata.** `finalizarPagamentoEmSegundoPlano()` usa o `waitUntil` da
Vercel para tentar em 10s, 30s e 60s **depois** que a resposta já foi entregue —
o hóspede nunca espera. Orçamento total de 90s; estourou, desiste em silêncio.
(`after()` do Next só existe da versão 15; aqui é `@vercel/functions`.)

**Camada 2, cron.** A fila `hostaway_pending_finalization` com backoff de
5/15/30/60/60/60 minutos, e escalada após 6 tentativas.

As duas usam a mesma guarda de idempotência: consultam as cobranças da reserva
antes de registrar, e **não registram** se a consulta falhar.

`POST /api/hostaway/finalizar-pagamentos` existe para agendador externo, com
`HOSTAWAY_FINALIZE_SECRET` — é a saída quando o plano da Vercel não permite cron
sub-diário.

## Diagnóstico auto-explicativo

`GET /api/admin/diagnostico` responde "a conversão da reserva X chegou?" **sem
abrir o painel do Google nem o do Meta**:

- `saude` — presença de credenciais (booleanos, nunca valores), contagem de
  conversões das últimas 24h por destino e resultado, estado da fila Hostaway e
  da reconciliação;
- `conversoes` — últimos 50 registros com `resultado`, `validacao_ga4`,
  `rota_origem` e `provider`;
- `?transaction_id=<id>` — filtra uma reserva específica.

`pulado_sem_credencial` é registrado como desfecho. Sem isso, "não há registro"
seria ambíguo entre "nunca tentou" e "tentou e faltou credencial" — e foi
exatamente essa ambiguidade que escondeu o problema do GA4.

## TTL do draft: 24 horas, com revalidação obrigatória antes de cobrar

O TTL era de **2 horas**. Numa reserva medida em produção o hóspede tentou pagar
seis vezes entre 01:20 e 01:38 UTC e só concluiu às 02:04 — 44 minutos entre o
começo e o fim, com troca de gateway no meio. Um checkout com retentativas passa
de duas horas com facilidade.

Quando o draft expira, some junto tudo que atribui a venda à campanha: `fbp`,
`fbc`, `gclid` e os UTMs são capturados **na criação do draft** (é a última
janela em que o navegador do cliente ainda existe) e vivem só ali. Foi
exatamente o que aconteceu com a reserva 65375857: a conversão chegou ao Meta
(`http=200`, `events_received: 1`) sem uma única fonte de atribuição.

**TTL agora: 24 horas** (`DRAFT_TTL` em `src/lib/kv-store.ts`; `expiresAt` das
duas rotas de draft deriva da mesma constante, para a tela e o store não se
contradizerem).

### Por que a revalidação não é opcional

Um draft que vive 24h carrega preço e disponibilidade que podem ter envelhecido.
Estender o TTL sem reconferir **troca um problema de atribuição por um problema
de cobrança errada** — que é muito pior. Por isso, `revalidarDraftAntesDeCobrar()`
(`src/lib/pricing/revalidar-draft.ts`) roda em **toda** rota que cobra, imediatamente
antes de autorizar:

| Rota | Momento |
|---|---|
| `/api/payments/credit` (Cielo cartão) | antes de `createCreditPayment` |
| `/api/payments/pix` (Cielo Pix) | antes de emitir o QR |
| `/api/payments/braspag/credit` | depois do 3DS, antes da autorização |
| `/api/payments/braspag/pix` | antes de emitir o QR |

O smoke tem uma verificação dedicada (nº 12) que reprova se qualquer uma dessas
quatro rotas deixar de chamar a guarda — exigindo a **chamada**, não a menção, para
que um `import` órfão não satisfaça a checagem.

### O que é reconferido, e o que não é

Só o que vem da Hostaway e muda sozinho: (1) disponibilidade das noites, (2) total
da Hostaway, (3) `closedOnArrival` do dia de chegada. O que vem do config local
(cupom, preço de extra, regra de pacote) não muda entre a criação do draft e o
pagamento dentro de um mesmo deploy.

A comparação de preço é entre `draft.totalPrice` e o novo `quote.totalPrice` — as
duas pontas da **mesma grandeza** (o total da Hostaway, gravado assim nos dois
caminhos, avulso e pacote V2). Comparar contra `finalTotal` misturaria desconto,
extras e Pix, e daria falso positivo a cada rodada. Tolerância de R$ 0,50 para
arredondamento.

### Desfechos

- **Preço divergiu** → não cobra nem o valor antigo nem o novo. Interrompe com
  HTTP 409 e mensagem ao hóspede dizendo que os valores mudaram, pedindo que
  refaça a busca para ver e confirmar o preço atualizado. A mensagem
  deliberadamente **não anuncia um valor novo**: o total final de um pacote não é
  o total da Hostaway (desconto progressivo, bônus e extras entram depois), e
  publicar ali um número que não seria o cobrado é pior que não publicar nenhum.
  Refazer a reserva recalcula tudo pelo motor de sempre — é essa a forma honesta
  de "pedir confirmação".
- **Data indisponível** → 409 com o motivo da Hostaway e o link do WhatsApp.
- **Chegada fechada** (`closedOnArrival`) → 409 explicando que a casa deixou de
  aceitar entrada naquele dia, com o WhatsApp.
- **Não deu para perguntar à Hostaway** (`api-error`, calendário sem o dia,
  listing não resolvida) → também interrompe. Quem está prestes a cobrar trata
  "a Hostaway disse não" e "não consegui perguntar" do mesmo jeito: cobrar sem
  confirmar é o único desfecho inaceitável.

Toda divergência é logada em nível `error` com `draftId`, datas, valor antigo,
valor novo, diferença e `createdAt` do draft.

Nenhuma página do checkout foi alterada: as rotas já devolvem `returnMessage`/
`error`, e a tela de pagamento já renderiza esses campos.

### Um dono só para a restrição de chegada

A revalidação chama `chegadaPermitida()` de `src/lib/pricing/restricoes-chegada.ts`
— a **mesma** função que a criação de draft e a exibição usam. Houve uma versão
intermediária que lia `closedOnArrival` do calendário por conta própria dentro de
`revalidar-draft.ts`; foi removida no merge. Duas leituras da mesma regra
divergem no dia em que uma das duas muda, e a mensagem ao hóspede passa a ter
duas redações. A mensagem também vem de lá (`mensagemChegadaBloqueada`), com o
link do WhatsApp anexado.

Uma diferença deliberada: `chegadaPermitida()` deixa exceção de rede subir, o que
é adequado em quem exibe preço. Na antessala da cobrança não é: a revalidação
envolve a chamada em `try/catch` e converte a exceção em recusa `indeterminado`
com mensagem explicada, em vez de um 500 genérico da rota.

## Cron da finalização Hostaway a cada 5 minutos (exige plano Pro)

`/api/hostaway/finalizar-pagamentos` passou de `15 6 * * *` (1x/dia) para
`*/5 * * * *`. A camada de `waitUntil` continua sendo o caminho principal — o
cron é a rede de segurança para o que ela não pegou.

**Isto depende do plano Pro.** No plano Hobby a Vercel só aceita cron diário, e
um cron sub-diário faz a validação **rejeitar o deployment em silêncio**: o
deploy não é criado e não aparece nem como erro na lista. Sintoma: commits param
de publicar sem explicação. Se a conta voltar para Hobby, este agendamento tem
que voltar para diário junto.

O `pix-reconcile` segue em `0 6 * * *`: ele varre drafts vivos e não tem a mesma
urgência.

## Variáveis Sensitive na Vercel não voltam por `vercel env pull`

Variável marcada como **Sensitive** no painel da Vercel não pode ser lida de
volta: `vercel env pull` grava um marcador (`[SENSITIVE]`) no lugar do valor. O
valor real só existe no painel e no runtime do deployment.

Isso custou uma rodada inteira: o `checar-ambiente.mjs` rodou com
`GA4_MEASUREMENT_ID` valendo literalmente a string `[SENSITIVE]` e reportou
"GA4 credenciais ACEITAS, payload valido".

Agora o script **detecta e recusa placeholders** (`[SENSITIVE]`, `[REDACTED]`,
`<...>`, `undefined`, `null`, `changeme`, `your-*`, vazio) antes de qualquer
chamada de rede, reportando `FALHA` — nunca `ok` — com a explicação de que a
variável não pôde ser lida. Valor fora do formato também para ali, em vez de
seguir para a rede como antes.

Para checar de verdade: ler o valor no painel da Vercel e exportá-lo no ambiente
antes de rodar o script.

## `/debug/mp/collect` não valida credencial do GA4

O endpoint `https://www.google-analytics.com/debug/mp/collect` devolve
`validationMessages` sobre a **estrutura do payload**. Ele **não** confere
`measurement_id` nem `api_secret`: credenciais erradas passam sem uma única
mensagem. Era essa a base do falso positivo acima — a verificação nunca provou
nada sobre a credencial.

O GA4 **não oferece equivalente** ao que o Meta oferece. No Meta, um
`GET /v21.0/<pixel_id>?access_token=…` no Graph API rejeita token inválido com
erro 190/OAuth: isso é verificação real de credencial. No GA4 não existe essa
porta.

Consequência prática, agora explícita na saída do script: a linha do GA4 é
`aviso`, não `ok`, e diz que valida estrutura, não credencial. A única prova de
que o GA4 contabilizou é o Realtime/DebugView no painel.

## Restrições de chegada (closedOnArrival)

### De onde vêm: da Hostaway, a cada consulta

O PMS marca `closedOnArrival` **dia a dia** no calendário, e o site lê esse
campo. Não há lista local de dias bloqueados.

A alternativa — configurar "domingo" por listing — foi descartada por medição,
não por preferência. Levantamento de 01/09 a 31/10/2026:

| Listing | Domingos com chegada fechada | Segundas | minimumStay observado |
| --- | --- | --- | --- |
| Sol 1 (316007) | **8 de 8** | 1 de 8 | 1, 3 |
| Sol 2 (316005) | **7 de 8** | 2 de 8 | 1, 2, 3 |
| Completo (316006) | **8 de 8** | 2 de 8 | 1, 3 |

O Sol 2 libera um domingo. Uma regra local de dia da semana erraria já nesse
caso, e desatualizaria em silêncio na primeira mudança feita no PMS. Lendo da
API, mudar a regra na Hostaway basta — o site acompanha sozinho.

**A restrição é de CHEGADA, não de ocupação.** Passar por cima de um domingo no
meio da estadia sempre foi permitido e continua sendo: só o dia de entrada é
consultado.

### Onde é decidido

`src/lib/pricing/restricoes-chegada.ts` é a única fonte. O Completo ocupa as
**duas** listings: basta uma delas recusar a chegada para a data estar fora — a
casa não pode ser entregue pela metade. Era um furo à parte, porque
`/api/availability/check` consultava só o listing do próprio `property.id`.

`indeterminado` distingue "a Hostaway disse não" de "não consegui perguntar".
Quem está prestes a cobrar trata os dois como recusa.

### A validação é do servidor; o front espelha

| Camada | Onde | Papel |
| --- | --- | --- |
| Preço | `calculatePriceDetailed` (falha `closed-on-arrival`) | cobre `/api/price` e `/api/pacotes/preco` |
| Disponibilidade | `/api/availability/check` | usa o módulo compartilhado |
| **Draft** | `/api/reservations/draft` | **última barreira antes da cobrança** |
| Interface | `AvisoChegada.tsx` + `/api/restricoes/chegada` | conveniência: avisa antes, não decide |

O front usa `<input type="date">` nativo, que não desabilita dias avulsos. A
marcação visual é a lista das próximas datas bloqueadas sob o campo, mais a
mensagem imediata quando a data escolhida é uma delas — com saída pelo WhatsApp.
Nenhum evento de analytics com `value` dispara numa data inválida.

O smoke reprova o build se a criação de draft deixar de chamar
`chegadaPermitida()`.

### Restrições que o site ainda NÃO respeita

Levantadas nesta rodada, **não corrigidas** — ficam para decisão:

| Restrição | Estado |
| --- | --- |
| `minimumStay` | Respeitada em `/api/availability/check` e em `calculatePriceDetailed`. **OK.** |
| `closedOnDeparture` | Só em `/api/availability/check`. O cálculo de preço e a criação de draft **ignoram** — dá para vender uma saída que o PMS recusa. |
| `maximumStay` | Declarado no tipo e há a razão `max-stay-exceeded`, mas **nada** compara. Estadia acima do teto passa. |
| Gap rules | Não consultadas. A API expõe via regras de disponibilidade; o site não lê. |

O `closedOnDeparture` é o mais próximo do problema desta rodada: mesma classe de
falha, na outra ponta da estadia.

## Simulação de pós-pagamento

`POST /api/admin/simular-pos-pagamento` roda o fluxo real **a partir do ponto em
que a autorização já teria dado certo**, sem cobrar cartão nenhum.

### Para que serve

Tudo que acontece depois do "aprovado" — criar a reserva na Hostaway, disparar a
conversão, enfileirar a marcação de pagamento, gravar em `conversions_sent` — só
era exercitado por uma venda de verdade. Testar isso custava um cartão real e um
estorno, então quase não era testado, e os defeitos apareciam em produção com um
hóspede no meio.

A rota executa as cinco etapas na ordem e devolve o que cada uma respondeu,
incluindo a **resposta crua da Hostaway**.

### O que ela NÃO valida: o 3DS

O 3DS acontece **antes** da autorização, no navegador, e continua sem ter como
ser exercitado fora de produção. A simulação começa depois disso. Nenhuma
conclusão sobre 3DS pode ser tirada de uma simulação bem-sucedida.

### Nenhum gateway é alcançável

O arquivo não importa `braspag.ts` nem `cielo.ts`, nem nada que os importe. O
`PaymentId` é sintético e identificável (`SIM-<provider>-<metodo>-<base36>`). A
verificação 13 do smoke reprova se um import de gateway aparecer ali — é essa
propriedade que torna a rota segura, e ela não pode depender de disciplina.

### Como isola dados de teste

| Risco | Isolamento |
|---|---|
| Purchase real no Meta | `test_event_code` **obrigatório**. Sem `META_TEST_EVENT_CODE` a rota RECUSA (412) em vez de enviar. Não existe "simular só um pouco": um Purchase sem o código entra no relatório **e na otimização de campanha**. |
| Evento contaminando o GA4 | `debug_mode: true` → DebugView, fora dos relatórios. É o que o GA4 oferece: não há equivalente ao `test_event_code`. |
| Calendário bloqueado | Reserva criada com `status: "inquiry"` e `isPaid: false` — consulta, não reserva confirmada. |
| Reserva confundida com real | Nome prefixado com `[SIMULACAO]`, `source: solarium-simulacao`, `reservaTeste: true` (que já põe o aviso na nota do anfitrião). |
| Ensaio no horizonte operacional | Recusa datas a menos de **90 dias**. Mais perto, a equipe vê o ensaio na lista de chegadas da semana e trata como real. |
| Ensaio contado como venda | `rota_origem: "simulacao"` no `conversions_sent`. |

Limpeza: `DELETE /api/admin/simular-pos-pagamento/{reservationId}`, sob o mesmo
token — deixar a criação protegida e a limpeza aberta daria a estranhos o poder
de cancelar reserva pelo número. Cancela e tira da fila de finalização junto
(uma reserva cancelada ainda enfileirada geraria tentativas de cobrança até
esgotar o backoff).

`scripts/simular-reserva.mjs` faz o ciclo completo: cria o draft, chama a rota,
imprime o relatório e cancela no fim (`--manter` preserva).

## Chave de acesso em código-fonte: o que foi encontrado e fechado

Cinco pontos guardavam acesso administrativo com a string `lucas2026` escrita no
próprio código, em repositório **público** e sem gate de ambiente:

```
GET  /api/debug/hostaway-reservation?key=lucas2026
GET  /api/debug/channels?key=lucas2026
GET  /api/debug/price-test?key=lucas2026
POST /api/debug/regenerate-token?key=lucas2026
GET  /debug/hostaway?key=lucas2026
```

A primeira dispara **seis tentativas de criação de reserva** contra a conta de
produção (listing 316007), uma delas com `status: confirmed` e `isPaid: true`. A
quarta derruba o cache do token de acesso da Hostaway. Segredo em código-fonte
não é segredo.

Porta única agora em `src/lib/admin-auth.ts`:

- `exigirAdmin()` — `ADMIN_API_TOKEN` em `x-admin-token` ou `Bearer`, comparado
  em tempo constante. **Nunca em query string**: URL vaza em log de servidor,
  histórico e cabeçalho `Referer`. Sem o token configurado o endpoint fica
  FECHADO (503), nunca aberto.
- `exigirAdminForaDeProducao()` — o mesmo, mais 404 quando `VERCEL_ENV` é
  `production`. Token sozinho não basta para rota que cria ou cancela coisa real
  no PMS: um token vazado viraria reserva de verdade no calendário.

A verificação 15 do smoke reprova qualquer chave literal usada como guarda.

## Hostaway: o que a documentação respondeu, e o que não

O suporte respondeu por bot que o schema não é documentado. O changelog da
referência (`https://api.hostaway.com/documentation`) contradiz isso em parte —
mas a página lista os recursos sem abrir os campos. O que ficou firme:

- **`status: "confirmed"` está DEPRECIADO para criação/atualização** desde
  2020-12-18. Nosso `createHostawayReservation` envia exatamente isso em toda
  reserva real. Não quebrou até hoje, mas é dívida com prazo.
- **`ownerStay`** (2021-03-31) identifica datas reservadas pelo proprietário e
  **não pode ter informação financeira** — por isso não serve para a simulação,
  que precisa exercitar justamente a parte financeira. `inquiry` é a escolha.
- **`priceDetails`** é o campo do detalhamento de preço na criação, e pode ir no
  mesmo `POST /v1/reservations` (2022-11-01).
- **Tipos financeiros**: `accommodation`, `commissions`, `tax`, `other`,
  `totals`. **A documentação não diz em qual deles um desconto entra** — é a
  pergunta que sobra para o suporte.
- **`GET /v1/reservations/paymentMethods`** é o endpoint dos métodos válidos.

`scripts/hostaway-contrato.mjs` pergunta o resto à própria API, só com leitura:
métodos de pagamento, uma reserva com e sem `includeResources=1` (para provar a
diferença) e a distribuição real de status na conta.

## Limite de taxa da Hostaway (429): não havia tratamento nenhum

`authFetch` repetia em 5xx e erro de rede. **429 é 4xx**, então caía no
`if (!res.ok)`, virava `null` na hora e o chamador via "preço indisponível" ou
"reserva não criada" — sem nada no log dizendo "limite".

O header `X-RateLimit-Retry-After` da Hostaway é um **timestamp Unix**, não uma
quantidade de segundos de espera. Interpretá-lo como delay faria o processo
dormir por décadas. O tratamento novo converte subtraindo o agora, com teto de
60s, e ignora valor implausível — relógio fora de sincronia não pode travar
requisição.

Limites conhecidos: `POST /v1/reservations` 200/10s;
`POST /v1/listings/{id}/calendar/priceDetails` 400/10s.

## `includeResources=1` e as taxas que somem

Sem esse parâmetro, `reservationFees` volta vazio em `GET /v1/reservations`.
Hoje o código só usa `includeResources=1` em `GET /listings/{id}` e **não lê
reserva nenhuma de volta**, então o problema não morde — mas mordia no instante
em que alguém fosse conferir a decomposição enviada e concluísse "a Hostaway não
gravou", quando na verdade não tinha pedido.

## Webhooks e a fila: não há alternativa a procurar

Os eventos suportados são `reservation created`, `reservation updated` e
`new message received`. **Não existe** evento de "reserva pronta para receber
cobrança". A fila `hostaway_pending_finalization` com retry e backoff continua
sendo a abordagem correta — a busca por um webhook que avise está encerrada.

## Observabilidade de falha de pagamento (PR 1)

Três incidentes em produção, todos invisíveis até alguém exportar log da Vercel
à mão. O que faltava não era corrigir — era **enxergar**.

### CSP: o corpo do relatório passou a ser lido

`/api/csp-report` recebeu 151 relatórios, respondeu 204 e descartou todos. Agora
cada violação vira uma linha `[CSP:violacao]` com `disposition`,
`effectiveDirective`, `blockedURL`, `documentURL`, `sourceFile`, `lineNumber`,
`statusCode` e `isPaymentRoute`.

`disposition` é o campo que importa: separa "isto bloqueou e quebrou o checkout
de alguém" de "isto quebraria se a política estivesse ligada". Ausente resolve
para `report`, **nunca** para `enforce` — afirmar bloqueio que não houve manda a
operação caçar problema inexistente.

**Deduplicação em memória, 60 segundos**, por chave
`disposition|effectiveDirective|blockedURL|isPaymentRoute`. Uma campanha já
gerou 147 linhas idênticas; o que interessa é o conjunto de origens distintas
mais a contagem. Em memória de propósito: o objetivo é enxugar log, e uma
instância nova recomeçando a contagem é mais barato que uma ida ao Redis por
relatório recebido.

A rota continua **sem autenticação e fora de qualquer middleware** — quem posta
é o navegador do visitante, que não tem credencial. Coletor protegido não recebe
nada e a cegueira volta.

Este ciclo **não altera a CSP**. O objetivo é descobrir o que ela bloqueia.

### Telemetria do 3DS: timeout de 120 segundos

Em 02/09 o mesmo dispositivo criou 8 sessões 3DS e fez **zero** chamadas de
cobrança. O fluxo morreu no navegador e não existe uma linha de log sobre isso.

`POST /api/payments/telemetry` registra oito etapas, de `3ds_iniciado` a
`pagina_abandonada`. Responde 204 sempre, nunca lança, nunca bloqueia o cliente:
medição que atrapalha pagamento é pior que medição nenhuma. Etapa fora da lista
é descartada em silêncio — o endpoint é público e não pode virar um canal para
escrever texto arbitrário no log.

**120 segundos** para o `3ds_timeout`, contados a partir de
`3ds_desafio_exibido`. Folgado de propósito: o desafio pode envolver o hóspede
abrindo o app do banco, e um limite curto marcaria como falha um fluxo que ainda
ia completar — poluindo justamente o sinal que estamos criando.

Este relógio é **só observação**. O prazo funcional do fluxo continua sendo o
`TIMEOUT_3DS_MS` de 5 minutos, intocado.

PII: só `draftId`, `provider`, `etapa` e um `detalhe` de até 200 caracteres.
Nunca cartão, e-mail, telefone ou nome — este log é o mais fácil de exportar.

### Notificação de falha terminal: 1 por draft a cada 15 minutos

Só o caminho de sucesso notificava alguém. Agora `enviarAlertaFalhaTerminal()`
usa o **mesmo Resend, mesmo destinatário e mesmo remetente** do alerta de
aprovação — nenhuma dependência nova.

Falha terminal = o hóspede não tem mais caminho automático nesta tentativa:

- `3ds_timeout` ou `submit_erro_rede` (via telemetria);
- **segunda** recusa consecutiva do emissor no mesmo draft;
- exceção não tratada em qualquer das duas rotas de cobrança;
- `AF-bloqueio` depois de o fallback também ter falhado (PR 2).

`3ds_retorno_falha` **não** entra: tem retry automático na tela, e notificar
cada uma traria de volta a enxurrada que o anti-flood existe para evitar.

**Anti-flood de 15 minutos**, chave `falha_pagamento_notificada:<draftId>` na
mesma camada de `webhook_events`. Usa `SET NX EX` — a reserva da janela é
atômica, então duas tentativas simultâneas do mesmo draft não passam as duas.
As seis tentativas do incidente de 28/08 (18 minutos) geram no máximo 2 e-mails.

Falha de Redis é **fail-open** (deixa notificar): perder o aviso de uma falha
terminal é pior que mandar um e-mail repetido.

A segunda recusa é o corte porque uma recusa isolada costuma ser dígito errado;
duas seguidas no mesmo draft é cartão que não vai passar. Erro de requisição
(HTTP não-2xx da Braspag) **não** conta: é problema nosso de credencial ou
payload, não do cartão do hóspede.

## Conciliação Hostaway: endpoint de cobranças

`GET /v1/reservations/{id}/offlineCharges` responde **404 consistentemente** em
produção (reservas 65714576 e 65375857), embora a documentação o descreva. A
cobrança existe: na 65714576 ela tem id `32909068`, tipo `CHARGE`, nome
"Pagamento no Cartão", status `DUE`, valor 5800,00.

A documentação também dá `PUT /v1/offlineCharges/{id}` para atualizar — caminho
**diferente** do que o código assumia (`PUT /reservations/{id}/offlineCharges/{chargeId}`).
Mas o **schema do corpo não está publicado**, e o endpoint de listagem que
funciona não foi determinado.

Decisão, pela regra "na dúvida, a opção conservadora":

1. `listarCobrancasHostaway` tenta o endpoint documentado primeiro — se a
   Hostaway habilitar o recurso na conta, é por ali que volta a funcionar.
2. Não funcionando, lê a própria reserva com `includeResources=1` (sem esse
   parâmetro a Hostaway não devolve recursos aninhados) e procura a coleção
   entre os nomes candidatos.
3. Não achando nenhuma, registra
   `[Hostaway:conciliacao] endpoint indeterminado reservation_id=<id>` com a
   lista de chaves que a reserva devolveu, dispara a notificação de falha e
   devolve `null`.

`null`, não `[]`. Não é "não há cobranças" — é "não sei onde elas estão".
Devolver lista vazia faria o chamador registrar uma cobrança que talvez já
exista, e cobrança duplicada exige estorno e conversa com o hóspede. Pendente
só espera.

**Impasse registrado:** o nome da coleção de cobranças e o schema do corpo do
`PUT` continuam sem confirmação. É pergunta para o suporte da Hostaway, não
para tentativa e erro contra a conta de produção.

## Diagnóstico do 401 nos crons

`/api/hostaway/finalizar-pagamentos`: 401 em **144 de 144** execuções.
`/api/payments/braspag/pix-reconcile`: 401 em 100% das diárias. Duas filas
paradas há semanas, e o log não dizia nada além do 401.

Antes de cada 401, sai `[Cron:auth] rota=<rota> header_presente=<bool>
secret_configurado=<bool> match=<bool>`, mais os **comprimentos** do recebido e
do esperado. Só booleanos e tamanhos — nunca o segredo nem parte dele. O
comprimento entra porque é o que denuncia espaço ou quebra de linha invisível na
ponta, causa que já derrubou um token correto neste projeto.

Os três booleanos separam as causas em **uma** execução: header ausente (a
Vercel não está mandando, logo `CRON_SECRET` não existe no projeto), segredo não
configurado no runtime, ou valores divergentes.

A verificação 17 do smoke exercita as duas rotas por HTTP quando
`SMOKE_BASE_URL` e o segredo estão no ambiente; sem eles é **pulada**, nunca
reprovada — falta de ambiente não pode quebrar o build.

## Fallback automático Braspag → Cielo (PR 2)

Quando o antifraude reprova, o hóspede era deixado sozinho na tela. Nos dois
incidentes reais ele tentou 6 e 8 vezes antes de conseguir — e no primeiro só
concluiu migrando **à mão** para a Cielo, 44 minutos depois de começar.

### A regra: segundo bloqueio

- A **primeira** tentativa não muda nada. A Braspag continua sendo a rota
  primária, e um bloqueio isolado pode ser transitório.
- No **segundo** `AF-bloqueio` do mesmo draft, o padrão está estabelecido: não é
  azar, é uma regra que vai reprovar de novo (reason 481 com score 28 sendo
  rejeitado indica regra fixa de perfil, do lado da Braspag). O draft ganha
  `provider_forcado = "cielo"`.
- A troca vale **só para aquele draft**. Nada de configuração global.

Contador em `af_bloqueio:<draftId>`, mesma camada de `webhook_events`.

`/api/payments/provider?draftId=<id>` passa a respeitar o `provider_forcado`
acima da flag global — é a única coisa que a sobrepõe. Sem `draftId`, ou com
draft ilegível, cai na flag: uma falha de leitura não pode deixar a tela de
pagamento sem gateway nenhum.

A resposta 402 da segunda tentativa carrega `fallbackDisponivel: true`. O front
reconsulta o provider e remonta a tela apontando para a Cielo, com os dados que
o hóspede acabou de digitar ainda no formulário — ele só reenvia, sem recomeçar
a reserva.

### Fail-safe para o lado conservador

`registrarBloqueioAntifraude` devolve `0` quando o Redis falha, e `0` não
dispara nada. Sem contador confiável, o conservador é **não trocar**: mandar o
hóspede para a Cielo por engano é pior que deixá-lo tentar de novo na Braspag.
Mesma coisa se a gravação do draft falhar — `fallbackDisponivel` volta `false`.

Isto é o oposto do fail-open da notificação, e de propósito: notificar demais
custa um e-mail, trocar de gateway indevidamente custa uma transação.

### O que NÃO muda

A rota Cielo já revalida preço e disponibilidade antes de cobrar, já usa o
número da reserva Hostaway como `transaction_id` (GA4) e `event_id` (Meta CAPI),
e já dispara conversão exclusivamente server-side. O fallback só redireciona
para ela: nenhuma instrumentação duplicada, nada movido para o cliente.

### Notificação

A falha terminal por antifraude só dispara **quando o fallback é acionado** — o
caminho automático acabou de ser trocado e, se este também falhar, não sobra
nada. Notificar no primeiro bloqueio seria alarme para algo que o próprio
sistema ainda vai resolver.
