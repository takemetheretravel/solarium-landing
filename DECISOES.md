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

**Somente o servidor.** `src/lib/analytics/dataLayer.ts` não exporta função de
compra, e o smoke falha o build se alguém adicionar uma.

`enviarConversaoServidor()` manda GA4 (Measurement Protocol) e Meta (CAPI) a
partir de três pontos, todos depois de a reserva existir no Hostaway:

- `src/app/api/webhooks/cielo/route.ts` (Pix/cartão Cielo);
- `src/lib/braspag-pix-confirm.ts` (Pix Braspag);
- `src/app/api/payments/braspag/credit/route.ts` (cartão Braspag, resolvido
  sincronamente — o webhook não age sobre ele).

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
