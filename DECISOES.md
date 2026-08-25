# DECISÕES

Registro técnico do que está ativo e onde. Fato, não justificativa.

## Tracking

### Identificadores ativos

| O quê | Valor | Onde vive |
| --- | --- | --- |
| GA4 Measurement ID (navegador) | `G-9J8F6Q1Y2M` | `src/lib/analytics/AnalyticsScripts.tsx`, hardcoded |
| Meta Pixel ID (navegador) | `1029814882379214` | `src/lib/analytics/AnalyticsScripts.tsx`, hardcoded |
| GA4 Measurement ID (servidor) | env `GA4_MEASUREMENT_ID` | `src/lib/analytics/server-conversions.ts` |
| GA4 API Secret | env `GA4_API_SECRET` | idem |
| Meta Pixel ID (servidor) | env `META_PIXEL_ID` | idem |
| Meta CAPI token | env `META_CAPI_ACCESS_TOKEN` | idem |
| Container GTM | **nenhum instalado** | — |

Não existe container GTM no código hoje. O `gtag.js` e o snippet do Meta Pixel
são carregados direto pelo `AnalyticsScripts`. A remoção deles depende de as
tags equivalentes estarem validadas no GTM Preview (pendência aberta abaixo).

Os scripts do navegador só carregam quando `VERCEL_ENV === "production"`
(`analyticsAtivo()` em `src/config/flags.ts`). Preview não emite medição.

### Identificador canônico de conversão

Um só valor percorre o funil e é o mesmo nas duas pontas (navegador e servidor):

1. **número da reserva Hostaway**, quando ela já existe;
2. **`draftId`** (o UUID de `/reservar/{uuid}/...`), enquanto é rascunho.

Regra implementada em `transactionId()` (`src/lib/analytics/dataLayer.ts`). É o
`transaction_id` do GA4 e o `event_id` do Meta — é ele que faz o Meta descartar
a duplicata quando pixel e CAPI reportam a mesma compra.

### Eventos no `dataLayer`

Todos empurrados por `src/lib/analytics/dataLayer.ts`. Nenhuma função desse
módulo dispara pixel ou gtag — quem lê o `dataLayer` é o GTM.

| Evento | Empurrado em | Parâmetros |
| --- | --- | --- |
| `view_package` | `PackageBooking` (após preço real chegar) | `event`, `transaction_id` (vazio nesta etapa), `value`, `currency`, `items[]`, `origem` |
| `begin_checkout` | `GuestForm`, após o draft ser criado | `event`, `transaction_id` (= draftId), `value`, `currency`, `items[]`, `payment_method` |
| `purchase` | `TrackPurchase`, na confirmação | `event`, `transaction_id`, `value`, `currency`, `items[]`, `payment_method`, `nights` |

`items[]` sempre traz `item_id` e `item_name` (pacote quando há pacote; casa
quando é avulso), mais `price` e `quantity`.

`transaction_id` sai vazio no `view_package` porque nessa etapa não existe nem
reserva nem draft — o identificador canônico só nasce no envio do formulário
de hóspede.

Além desses, os eventos de produto (`pacote_visualizado`, `extra_selecionado`,
`reserva_concluida`, …) seguem em `src/lib/analytics/tracking.ts`, que fala com
`gtag`/`fbq` diretamente. Eles não são eventos de e-commerce.

### Quem dispara Purchase

Duas camadas, deduplicadas pelo identificador canônico:

- **Navegador** — `TrackPurchase` empurra `purchase` no `dataLayer` da página de
  confirmação. Guarda de idempotência em duas camadas: memória de módulo (mata
  StrictMode e re-render) e `sessionStorage` com chave `solarium:purchase:<id>`
  (mata o recarregamento da confirmação). Escopo de aba; nada persiste entre
  sessões.
- **Servidor** — `enviarConversaoServidor()` manda GA4 (Measurement Protocol) e
  Meta (CAPI) a partir de três pontos, todos logo depois de a reserva Hostaway
  existir:
  - `src/app/api/webhooks/cielo/route.ts` (Pix/cartão Cielo);
  - `src/lib/braspag-pix-confirm.ts` (Pix Braspag);
  - `src/app/api/payments/braspag/credit/route.ts` (cartão Braspag, resolvido
    sincronamente — o webhook não age sobre ele).

A idempotência do envio server-side vem da tabela `webhook_events`
(`payment_id` + `change_type`, chave única, TTL 30 dias): um `PaymentId` já
processado nunca reenvia conversão. Falha de rede, token inválido ou 4xx no
envio são engolidos com log — não afetam a reserva.

`client_id` do GA (cookie `_ga`) e `_fbp`/`_fbc` do Meta são lidos dos cookies
na criação do draft (`src/app/api/reservations/draft/route.ts`) e gravados nele,
porque no momento do envio server-side o navegador do cliente já não está por
perto.

### Isolamento da rota de pagamento

`/reservar/[draftId]/pagamento` renderiza os campos `bpmpi_*` do 3DS com dados
de cartão no DOM. Nessa rota:

- `AnalyticsScripts` retorna `null` (lista em `ROTAS_SEM_TERCEIROS`) — nenhum
  script de analytics, tag manager, chat ou gravação de sessão carrega;
- `src/middleware.ts` aplica uma CSP restritiva **só nessa rota**. `script-src`
  permite `'self'`, `mpi(sandbox).braspag.com.br` e `h.online-metrix.net`
  (fingerprint do antifraude Cybersource). `frame-src` é permissivo porque o
  challenge 3DS abre o ACS do banco emissor, cujo domínio varia e não é
  enumerável;
- a entrada na rota é uma navegação **dura** (`window.location.assign` no
  `GuestForm`). Num `router.push` o documento seria o da página anterior, com
  os scripts que ela já carregou e a CSP que ela já recebeu.

O smoke (`npm run smoke`) falha o build se algum arquivo da rota de pagamento
importar um módulo de analytics de navegador.

## Pendências

- **Remoção do `gtag.js` hardcoded — BLOQUEADA.** Só depois de as tags
  equivalentes estarem validadas no GTM Preview pelo time de marketing. Removê-lo
  antes deixa o site sem medição de Purchase durante a janela. Quando liberado:
  apagar os `<Script>` de `src/lib/analytics/AnalyticsScripts.tsx` e deixar o GTM
  como único carregador.
