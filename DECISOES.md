# DECISOES

Registro de decisões e fatos apurados. Criado na rodada A1, sobre a `main`.

> A branch de galeria (`feat/galeria-cloudinary`) e as anteriores têm um
> `DECISOES.md` próprio, ainda não mergeado. Quando elas entrarem, os dois
> arquivos precisam ser unidos à mão.

---

HEAD
## Rodada AF1 — Bloqueio server-side de draft em análise (set/2026)

Branch `fix/af1-bloqueio-analise`, a partir de `origin/main` (`0463bf5`).
Dividida da S1 (credenciais em rotas de debug), que vai em PR próprio.

### Rotas levantadas

Toda rota que recebe `draftId` e cria ou confirma pagamento:

| Rota | Gateway | Antes |
|---|---|---|
| `POST /api/payments/pix` | Cielo (cria Pix) | sem trava |
| `GET /api/payments/pix/status` | Cielo (consulta, marca `paid`, cria reserva) | sem trava |
| `POST /api/payments/credit` | Cielo (cartão) | sem trava |
| `POST /api/payments/braspag/pix` | Braspag (cria Pix) | sem trava |
| `GET /api/payments/braspag/pix/status` | Braspag (consulta e confirma) | sem trava |
| `POST /api/payments/braspag/credit` | Braspag (cartão) | **já barrava** (A2a), não mexida |

Não existe endpoint de nova tentativa separado: a nova tentativa é chamar de
novo uma dessas. `pix-reconcile` só pega drafts `pending` e os webhooks não
recebem `draftId` do chamador.

### Decisões

1. **Um helper, `barrarSeEmAnalise`, em `src/lib/bloqueio-analise.ts`,** chamado
   logo depois de ler o draft e antes de qualquer gateway. Com a flag de Review
   ligada ou desligada: o estado pode existir de antes de alguém desligá-la.
2. **HTTP 409** com um corpo que atende todos os contratos existentes: `error`
   (lido pela tela de Pix), `approved: false` e `returnMessage` (cartão),
   `estado: "aguardando_analise"` e `redirectTo` (tela A2b).
3. **Texto ao hóspede é o `TEXTO_ESPERA` da A2b** ("Recebemos sua reserva. O
   pagamento foi autorizado e estamos finalizando a confirmação…"). O prompt
   sugeria "pagamento em processamento", mas "em processamento" está na lista
   proibida do CLAUDE.md. Venceu o CLAUDE.md, e o texto já é o que a tela mostra.
4. **Log `[Bloqueio:aguardando_analise]`** com rota, draftId, PaymentId em
   análise, o motivo e a saída (`POST /api/admin/antifraude`). Sem nome, e-mail
   ou CPF.
5. **Alerta por e-mail ao operador** (`enviarAlertaBloqueioAnalise`), **uma vez
   por draft e rota a cada 24h** via `reservarEnvioUnico`. A rota de status é
   chamada em polling; sem a janela, seria um e-mail a cada 5s.
6. **Status de Pix também é barrado.** Se o hóspede pagou um Pix antes de ir para
   o cartão que caiu em Review, a confirmação desse Pix fica parada até a análise
   ser resolvida. Liberar criaria uma segunda reserva quando o cartão fosse
   aceito. O alerta deixa o caso visível, e a decisão é humana.
7. **`src/lib/cielo` não foi tocado.** A checagem está nas rotas.

### Achados fora de escopo (não corrigidos)

1. **Webhooks de Pix não passam pela trava.** `confirmPixPaymentIfPaid`, chamado
   pelos webhooks Braspag e Cielo, não olha `aguardando_analise`. Hoje ele só
   age em draft com `paymentMethod: "pix"` e `braspagPaymentId`; um draft que
   gerou Pix e depois foi para cartão em Review pode cair aí. Decidir se a trava
   entra também no helper de confirmação, que é compartilhado.
2. **`DECISOES.md` vai conflitar com o PR da S1.** As duas rodadas inserem a
   seção no mesmo ponto. A resolução é manter as duas seções.

## Rodada S1 — Credencial exposta em rotas de diagnóstico (set/2026)

Branch `fix/s1-credenciais-debug`, a partir de `origin/main` (`0463bf5`). A
rodada nasceu junto com a AF1 (bloqueio server-side de draft em análise) e foi
dividida em duas: somadas passavam de 12 arquivos.

### Decisões

1. **Porta única em `src/lib/admin-auth.ts`.** `tokenAdminValido` exige
   `Authorization: Bearer <ADMIN_API_TOKEN>`, compara em tempo constante e
   devolve falso com a variável ausente ou vazia. Qualquer falha responde
   **404**. `b8e5192` foi só consulta: lá sem token era 503 e havia header
   alternativo `x-admin-token`; aqui é 404 sempre e só Bearer, como pedido.
2. **`/api/admin/antifraude` não foi migrada para a porta nova.** A lógica é
   idêntica e já tem teste; migrar mexeria em rota fora do escopo sem ganho de
   segurança. Fica para uma triagem.
3. **A página `/debug/hostaway` e o `PriceTester` foram apagados.** Navegação de
   navegador não envia `Authorization`, então a página não tinha como exigir
   Bearer — só com chave em query string ou embutida no HTML, que é exatamente
   o que se quer eliminar. Tudo que ela mostrava sai das rotas `/api/debug/*`
   via `curl` com o header.
4. **`/api/debug/regenerate-token` responde JSON em vez de redirect.** O
   redirect servia à página apagada e aceitava destino arbitrário do
   formulário (redirect aberto).
5. **`/api/payments/braspag/authlog` migrou de `BRASPAG_RECONCILE_SECRET` por
   query string para `ADMIN_API_TOKEN` por header.** Sem compatibilidade.
6. **`pix-reconcile` deixou de aceitar `?secret=`.** Mesmo segredo e mesmo
   padrão do authlog. A autenticação continua a da rota (header
   `x-reconcile-secret` ou o Bearer do Vercel Cron, 401 em falha): trocar para
   `ADMIN_API_TOKEN` quebraria o cron, que só envia `CRON_SECRET`. O cron em
   `vercel.json` usa header e não é afetado.
7. **O teste de varredura olha `src`, `scripts`, `content` e `public`.** Não
   olha `docs/` nem `DECISOES.md`, que registram o incidente.

### ⚠️ Depois do merge

- **Trocar o valor de `BRASPAG_RECONCILE_SECRET` na Vercel.** Ele trafegou em
  URL (authlog e pix-reconcile) e ficou em log de acesso.
- **Conferir que `ADMIN_API_TOKEN` existe em Production e Preview.** Sem ela as
  rotas de debug e o authlog respondem 404 sempre — fechado, não quebrado.
- A chave antiga das rotas de debug deixa de valer com o merge (não era env
  var). Como `hostaway-reservation` criava reservas de teste na conta de
  produção, vale conferir no painel se há reservas "DEBUG TEST - DELETE ME".

### Achados fora de escopo (não corrigidos)

1. **`/api/debug/hostaway-reservation` cria reservas reais na Hostaway de
   produção** (seis tentativas, uma `confirmed` com `isPaid: true`). Agora exige
   token, mas não tem trava de ambiente. `b8e5192` a bloqueava em produção.
   Decidir se a rota ainda serve para algo ou se sai.
2. **O literal da chave antiga continua em `docs/pacotes-v2-pr.md`** e em
   `.claude/settings.local.json`, que está versionado. Depois do merge a chave
   não abre nada, mas o arquivo de settings local não deveria estar no git.
3. **`pix-reconcile` compara segredo com `===`**, não em tempo constante, e
   responde 401/503 em vez de 404.
4. **`GET /api/payments/braspag/test` é público** por decisão registrada no
   código (health check para a Braspag, só booleanos). As demais rotas
   `braspag/*-test`, `3ds-init-probe` e `pix-status` já respondem 404 em
   produção por `BRASPAG_ENVIRONMENT`, mas ficam abertas em preview.
fix/s1-credenciais-debug

---

## Rodada A3 — Desfecho da análise (set/2026)

Branch `feat/a3-desfecho-analise`, a partir da A2b. Tudo continua atrás de
`ANTIFRAUDE_REVIEW_ENABLED`: sem a flag nenhum draft entra em análise, então
nada aqui é acionado.

### Fato apurado nesta rodada

- 🚨 **O portal Braspag de produção notifica `/api/webhooks/cielo`, não
  `/api/webhooks/braspag`.** Está escrito no próprio webhook Cielo ("a URL
  cadastrada no portal de PRODUÇÃO da Braspag é este endpoint") e em
  `docs/observacao-lancamento-pacotes.md`. Consequências:
  - a A3 entra **nos dois** webhooks, com o mesmo núcleo;
  - a captura de webhooks não tratados da A1 (`af:webhooks-nao-tratados`) está
    no endpoint que **não recebe tráfego real**. Enquanto a URL não mudar, a
    contagem por ChangeType em `/api/admin/antifraude` vai ficar zerada.

### Decisões

1. **Gatilho não é o ChangeType.** Para qualquer notificação cujo PaymentId
   seja de um draft em `aguardando_analise`, consulta
   `GET /v2/sales/{PaymentId}` e resolve pelo estado real. O ChangeType vai só
   para o log. Texto, número desconhecido ou ausente reconciliam igual.
   - Filtro: `findDraftEmAnalisePorPaymentId` varre os drafts vivos antes de
     qualquer consulta. O volume de cartão é baixo. Uma notificação que não é
     deste fluxo segue exatamente o caminho de antes.

2. **Um caminho de código só.** `reconciliarPagamentoEmAnalise` é chamado pelo
   webhook Braspag, pelo webhook Cielo e pela rota manual. No caminho da
   reconciliação, os webhooks respondem **200 sempre**, inclusive com erro
   interno. O resto dos webhooks mantém o comportamento anterior (o Braspag
   ainda devolve 500 em erro do fluxo de Pix, de propósito).

3. **Idempotência em três camadas**, todas antes de qualquer efeito:
   1. marcador definitivo `trava:reconciliacao:<PaymentId>:aceito|recusado`,
      30 dias;
   2. trava de processamento `trava:reconciliacao:<PaymentId>:processando`,
      2 min, **fail-closed**: Redis fora do ar devolve `erro` e não faz nada;
   3. releitura do draft dentro da trava: só segue se ainda estiver em análise
      com o mesmo PaymentId.

   As camadas 1 e 3 são redundantes de propósito. A mutação que remove a 3
   continua barrada pela 1; a que remove a trava (2) reprova o teste de
   notificações em paralelo.

4. **Accept**
   - Captura `PUT /capture` com o valor autorizado em centavos.
   - Só com `Status 2`: grava o marcador, marca `paid` (+ `braspagPaymentId`,
     `analise.desfecho`), cria a reserva, manda o alerta de aprovação e o e-mail
     de confirmação ao hóspede.
   - **Conflito com o próprio bloqueio.** A decisão é **liberar as noites da
     estadia imediatamente antes de criar a reserva**. Se a criação falhar,
     elas são bloqueadas de novo, o órfão é registrado
     (`registerOrphanAndAlert`) e o draft fica com `hostawayReservationId: -1`,
     como no Accept direto. Os bloqueios de early/late não são liberados:
     continuam necessários e `blockOpExtraNights` os reafirma.
     - **Por quê:** não está verificado se a Hostaway aceita criar reserva sobre
       noite indisponível. Liberar antes funciona nos dois casos. A janela de
       segundos com as datas livres é desprezível diante do volume. A
       alternativa (criar e só depois liberar) pode travar a criação e deixar
       um cliente com dinheiro capturado sem reserva.
   - **Captura que falha:** não grava marcador, não marca `paid`, não cria
     reserva e não libera noites. Registra a tentativa em
     `analise.tentativasCaptura` e manda o alerta 🚨 "CAPTURA FALHOU". A trava
     é liberada, então a próxima notificação ou a rota manual tentam de novo.
     Autorização que já não está viva (`Payment.Status` diferente de 1 e 2) cai
     no mesmo caminho, sem tentar capturar.
   - Se a consulta já mostrar `Payment.Status 2` (capturado pelo portal, ou uma
     execução anterior que caiu depois de capturar), segue sem capturar de
     novo.
   - O e-mail de confirmação ao hóspede só sai **com a reserva criada**. No
     órfão, o alerta manda criar à mão e o contato é humano.

5. **Reject**
   - Grava o marcador, libera todas as noites de `analise.bloqueios`, marca
     `failed` e manda ao hóspede o e-mail "não conseguimos concluir o
     pagamento", com convite a Pix ou outro cartão pelo WhatsApp.
   - **Sem void:** o gateway cancela a autorização sozinho.
   - Noites que não liberarem vão listadas no alerta interno.

6. **Sem Accept/Reject legível na consulta.** O `FraudAnalysis` pode não vir no
   GET; não está verificado. O próprio pagamento decide:
   - `Payment.Status 2` → aceito, sem nova captura;
   - `Payment.Status 10/11/13` → recusado (cancelamento automático do Reject);
   - qualquer outra coisa → `indefinido`: nenhum efeito e **um** alerta por
     PaymentId.

   Consulta com HTTP de erro devolve `erro`, sem efeito.

7. **Rota manual:** `POST /api/admin/antifraude` com `{ "paymentId": "<guid>" }`
   e `Authorization: Bearer <ADMIN_API_TOKEN>`. Responde 404 sem o header e 400
   sem GUID. Reusa a autenticação do GET e o mesmo núcleo dos webhooks. Um teste
   compara o estado final e as chamadas via manual e via webhook.

8. **E-mails de desfecho** em `comunicacao-analise.ts`, cada um uma vez por
   PaymentId (`envio-unico:email:confirmacao|nao-concluido:<id>`).
   - O de recusa passa pela mesma varredura de palavras proibidas da A2b.
   - O de confirmação pode dizer "confirmada", porque agora é verdade, mas não
     menciona revisão nem análise.

9. **A reserva após o Accept replica a do Accept direto** (mesmos parâmetros),
   sem refatorar a rota de crédito, que o escopo proibia. Custo: duas cópias
   para manter em sincronia. Qualquer campo novo em `createHostawayReservation`
   precisa entrar nos dois lugares.

### Riscos conhecidos

- **Queda entre a captura e o `paid`.** A trava expira em 2 min; a próxima
  execução vê `Payment.Status 2` e segue sem capturar de novo.
- **Queda entre o `paid` e a criação da reserva.** O draft fica `paid` sem
  reserva e as execuções seguintes param em `ja-resolvido`. É a mesma janela
  que o Accept direto já tem. O alerta de aprovação não sai, e a ausência dele
  é o sinal.
- **Redis fora do ar na busca do draft.** `scanAllDrafts` devolve lista vazia e
  a notificação passa como "não é deste fluxo". Nada é feito; a rota manual ou
  a próxima notificação recuperam.

### Pendências

- **Cron de segurança:** varrer drafts em `aguardando_analise` há mais de 6h e
  chamar o mesmo núcleo. O projeto aparece como Pro no painel; confirmar no
  faturamento antes, porque no Hobby um cron sub-diário faz a Vercel rejeitar o
  deploy em silêncio.
- **URL de notificação:** decidir se muda para `/api/webhooks/braspag` no portal
  ou se a observabilidade da A1 passa a registrar também no webhook Cielo.
- **Purchase (lacuna aceita):** com o purchase client-side, uma venda aprovada
  depois do Review não gera purchase. Resolver junto com a migração para
  server-side que está nas branches paradas.
- **Pré-requisito da A2b continua valendo:** `EMAIL_REMETENTE_HOSPEDE` com
  domínio verificado no Resend. Sem ele, nenhum dos três e-mails ao hóspede sai.

### Ordem de subida (as três juntas)

1. Mergear A2a (#2), A2b e A3 na `main` com a flag **desligada**. O
   comportamento em produção só muda pela correção do status em texto (A2a,
   decisão 1).
2. Configurar `EMAIL_REMETENTE_HOSPEDE`.
3. Ligar a flag no preview e testar: Review → espera → reconciliação manual.
4. Ligar em produção e acompanhar `/api/admin/antifraude` nos primeiros dias.

---

## Rodada A2b — Comunicação com o hóspede em análise (set/2026)

Branch `feat/a2b-comunicacao-analise`, a partir da A2a. Não mexe em CSP, grupos
de layout, 3DS nem na exclusão do GTM. Nenhuma decisão de pagamento muda.

### Decisões

1. **Um lugar só para o texto.** `src/lib/comunicacao-analise.ts` guarda
   `TEXTO_ESPERA`, usado pela tela, pelo e-mail e pela `returnMessage` da rota.
   A direção do texto veio pronta: "Recebemos sua reserva. O pagamento foi
   autorizado e estamos finalizando a confirmação…".

2. **Linguagem verificada por teste, não só por revisão.** A tela renderizada, o
   e-mail (assunto, HTML e texto) e a resposta da rota são varridos contra:
   avaliação, análise, risco, antifraude, pendente, em processamento,
   verificação, "reserva confirmada" e "pagamento aprovado" (com e sem acento).
   Os nomes internos (arquivo, funções, `estado`) continuam falando em análise:
   o hóspede não os lê.

3. **Tela de confirmação.** `varianteConfirmacao(draft)`:
   - `paid` → a página de sempre, com `TrackPurchase`;
   - `aguardando_analise` → a variação de espera: ícone de e-mail em vez de
     check, "Valor autorizado" em vez de "Total pago", botão de WhatsApp, **sem
     `TrackPurchase`**;
   - qualquer outro status → `redirect("/")`, como antes.

4. **Purchase não dispara na espera.** O `TrackPurchase` só existe na variante
   confirmada. Continua client-side, sem migrar.

5. **Página de pagamento** — duas mudanças, as mínimas para ler o contrato:
   - resposta com `estado: "aguardando_analise"` → vai para a confirmação, em vez
     de mostrar a mensagem como erro de cartão;
   - draft carregado já em `aguardando_analise` → `router.replace` para a
     confirmação. Sem isso, voltar à página reabria o formulário e o Pix,
     caminho para uma segunda cobrança (achado 1 da A2a, lado da tela).

6. **E-mail ao hóspede, uma vez por autorização.** Sai pela rota de crédito no
   momento em que o draft entra em análise — nunca pela página, que pode ser
   recarregada à vontade.
   - Trava `envio-unico:email:espera:<PaymentId>` (SET NX, 7 dias), gravada
     antes do envio.
   - Se o envio falhar, a trava é liberada e a próxima reentrada (novo POST no
     draft em análise) tenta de novo.
   - Em falha de Redis, fail-open: um e-mail repetido é melhor que um hóspede
     sem notícia de um cartão autorizado.
   - O resultado ("enviado", "já enviado antes", "NÃO ENVIADO (motivo)") vai no
     alerta interno. Quando não saiu, o alerta pede para avisar pelo WhatsApp.

7. **Mesma infraestrutura, remetente próprio.** `enviarEmailHospede` usa o mesmo
   cliente Resend dos alertas, com o remetente lido de
   **`EMAIL_REMETENTE_HOSPEDE`**. Sem essa variável, não envia e diz por quê. A
   recusa do Resend (que devolve `{ error }` em vez de lançar) também não conta
   como envio.

### ⚠️ Pré-requisito antes de ligar a flag

- **Hoje nenhum e-mail ao hóspede chega.** Os alertas saem de
  `onboarding@resend.dev`, remetente de teste do Resend que só entrega para o
  dono da conta. É preciso:
  1. verificar um domínio no Resend (ex.: `solariummantiqueira.com`);
  2. criar `EMAIL_REMETENTE_HOSPEDE` na Vercel, por exemplo
     `Solarium Mantiqueira <reservas@solariummantiqueira.com>`.

  Sem isso, a tela de espera promete um e-mail que não sai. O alerta interno
  mostra "NÃO ENVIADO" e o hóspede precisa ser avisado pelo WhatsApp.

### Achados fora de escopo (não corrigidos)

1. **A rota de Pix não barra o draft em análise no servidor.** A tela agora tira
   o hóspede da página de pagamento, mas um POST direto em
   `/api/payments/braspag/pix` ainda geraria um Pix. Continua pendente.
2. **O JSX roda no modo clássico no Vitest.** O teste da página expõe
   `React` global para renderizar. Configurar `esbuild.jsx: "automatic"` no
   `vitest.config.ts` resolve de vez.
3. **O botão de WhatsApp da confirmação tem o número escrito à mão.** Na
   variante confirmada ele está fixo no código, enquanto a variante de espera
   usa `whatsappLink` de `config/site`. Não mexi na confirmada.

---

## Rodada A2a — Motor do estado de análise (set/2026)

Branch `feat/a2a-review-antifraude`, a partir de `origin/main` com a A1
(`85e6a8d`). Tudo o que é novo fica atrás de `ANTIFRAUDE_REVIEW_ENABLED`,
desligada por padrão. As rodadas A2a, A2b e A3 sobem juntas: ligar a flag sem a
A3 deixa o hóspede em espera sem desfecho.

### Decisões

1. **O `if` de decisão passa a ler o status normalizado — com e sem a flag.**
   `BraspagTransactionResult.fraudStatus` agora é `normalizarFraudStatus(...)`.
   `"1"`, `"Accept"` ou `"accept"` em texto capturam, como o número 1. Até a A1,
   texto virava void e recusa de pagamento legítimo. Isso é conserto de bug, não
   funcionalidade nova. `fraudStatusParaDecisao` (A1) foi removida.

2. **Flag:** `antifraudeReviewAtivo()` em `src/config/flags.ts`. Liga só com
   `"true"` (caixa e espaços tolerados). Qualquer outro valor mantém o void em
   Review.

3. **Estado novo:** `ReservationDraft.status` ganha `"aguardando_analise"` e o
   bloco opcional `analise`, que guarda:
   - `paymentId` e `merchantOrderId`;
   - `entrouEm`;
   - `valorAutorizado` (em reais e em centavos) e `parcelas`;
   - `bloqueios`: a lista exata de `{ listingId, noite }` segurados.

   Nenhum dado do hóspede. `braspagPaymentId` **não** é preenchido: esse campo
   significa pagamento confirmado para o webhook Cielo e a rota de Pix. Nenhum
   código na `main` fazia `switch` exaustivo sobre o status; as comparações
   existentes (`=== "paid"`, `=== "pending"`) já tratam o valor novo como "não
   pago" e "não pendente de Pix", que é o correto.

4. **TTL:** draft em análise vive **72h** (`DRAFT_TTL_ANALISE`). O prompt pedia
   no mínimo 12h. A revisão leva até 4h, e a reconciliação manual da A3 pode vir
   bem depois disso. Sem o draft, perde-se a lista do que desbloquear. O TTL é
   escolhido pelo status resultante em `saveDraft` e `updateDraft`, então
   atualizar outro campo não devolve o draft a 2h.

5. **Fluxo em Review com a flag ligada** (`Payment.Status 1` + status normalizado 3):
   - sem void, sem captura, sem reserva, sem `paid`;
   - bloqueia as noites da estadia (do check-in à véspera do check-out) na
     listing reservada **e** nas físicas. No Completo são as três listings, sem
     depender de a Hostaway propagar o bloqueio entre listings ligadas;
   - noites de early/late (`noitesABloquear`) só nas físicas, como já faz
     `blockOpExtraNights`;
   - listings em paralelo, noites em série dentro de cada uma: no máximo 3
     chamadas simultâneas à Hostaway;
   - grava o draft e **relê** para confirmar, porque `updateDraft` volta em
     silêncio se o draft sumiu;
   - log `[Braspag:Review-aguardando]` e e-mail interno `enviarAlertaEmAnalise`;
   - `maxDuration = 60` na rota de crédito: autorização + N chamadas de
     calendário não cabem no limite padrão.

6. **Contrato da resposta em Review** — HTTP 202:
   ```json
   {
     "approved": false,
     "estado": "aguardando_analise",
     "paymentId": "<guid>",
     "redirectTo": "/reservar/<draftId>/confirmacao",
     "returnMessage": "Recebemos sua reserva. O pagamento foi autorizado e estamos finalizando a confirmação. Você recebe o e-mail com todos os detalhes em algumas horas."
   }
   ```
   `approved: false` de propósito: a página atual só redireciona e dispara
   purchase com `approved: true`, então sem a A2b o hóspede nunca cai numa
   confirmação de pago. A tela deve ler `estado`. Sem `estado`, vale o contrato
   antigo.

7. **Guarda contra segunda autorização:** draft já em `aguardando_analise`
   devolve o mesmo 202 **antes** de autorizar de novo, com ou sem a flag. Uma
   nova tentativa prenderia o limite do cartão duas vezes.

8. **SALVAGUARDA — bloqueio falhou: volta ao void.** É tudo ou nada. Se qualquer
   noite não bloquear, ou o draft não for gravado, libera o que já bloqueou e
   segue o caminho antigo: void, alerta de recusa, 402. O motivo vai para o
   alerta, com as noites que não puderam ser liberadas, se houver.

   **Por quê:** a alternativa (seguir e alertar) deixa um hóspede de alto valor
   esperando com as datas livres. Se o analista aprovar horas depois e alguém
   tiver reservado nesse meio-tempo, vira overbooking numa casa premium, com o
   dinheiro já capturado. Perder a venda é o comportamento conhecido de hoje;
   overbooking é pior e mais difícil de desfazer.

9. **`unblockCalendarNight`** em `src/lib/hostaway.ts`: mesmo PUT com
   `isAvailable: 1`. É idempotente por construção (valor absoluto) e não lança.
   **Não cancela reserva:** a Hostaway calcula a disponibilidade com as reservas
   por cima do calendário. Por isso só se libera o que está em
   `analise.bloqueios`. Quem chama no fluxo normal é a A3; na A2a só a
   salvaguarda usa.

### Pendências

- **A2b:** tela e e-mail ao hóspede lendo `estado`. A mensagem hoje é exibida
  pela página antiga como erro de cartão; é aceitável só porque a flag está
  desligada.
- **A3:** a criação da reserva no Accept vai encontrar as noites bloqueadas por
  nós mesmos. A decisão (desbloquear antes, converter ou outro caminho) é da A3.
- **Lacuna aceita:** com o purchase client-side, uma venda aprovada depois do
  Review não gera purchase — o hóspede já saiu da página. Resolver junto com a
  migração para server-side que está nas branches paradas.

### Achados fora de escopo (não corrigidos)

1. **Pix e Cielo não conhecem a espera.** `/api/payments/braspag/pix` e
   `/api/payments/credit` (Cielo) não checam `aguardando_analise`: um hóspede
   em espera que abrir a página de novo pode gerar um Pix ou pagar pela Cielo
   no mesmo draft. A A2b deve tirá-lo da tela de pagamento; um guarda
   server-side nessas rotas fica como pendência.
2. **Não há guarda para draft já `paid` na rota de crédito Braspag.** Uma
   segunda requisição num draft pago autoriza de novo. Isso já existia antes
   da A2a.

---

## Rodada A1 — Observabilidade do antifraude (set/2026)

Branch `feat/a1-observabilidade-antifraude`, a partir de `origin/main`.
**Nenhuma decisão de pagamento muda nesta rodada.**

### Fatos apurados

**Produção** (diagnóstico A0, confirmado via Vercel CLI em 14/09/2026)
- O deploy de produção sai da `main`: o deploy de 14/09 08:52:24 corresponde
  ao commit `e1289dc`, de 08:52:21.
- A Braspag é o provider ativo em produção (`PAYMENT_PROVIDER = "braspag"`).
- A Cybersource ativou Revisão Manual de 4h neste MerchantId.

**Contrato do antifraude**
- `Payment.FraudAnalysis.Status` é **numérico**:
  0 Unknown · 1 Accept · 2 Reject · 3 Review · 4 Aborted · 5 Unfinished.
- O código lia com `fa.Status as number`, sem verificar. Se o valor viesse
  como texto, passava adiante sem ninguém perceber.

**Decisão da rota de crédito** (`src/app/api/payments/braspag/credit/route.ts`)
- É feita em duas etapas: primeiro `Payment.Status !== 1` (recusa do
  emissor), depois `fraudStatus !== 1` (bloqueio do antifraude).
- Um Review (3) cai hoje no bloqueio: void, e-mail de alerta, HTTP 402. Não
  captura, não cria reserva, não dispara purchase.

**Confirmado com a Braspag/Cielo (set/2026)**
- Em Review, a transação deve ficar **autorizada e não capturada**. Dar void em
  Review é errado (correção na A2).
- A decisão final chega por notificação automática, não por polling.
- Em Reject, o gateway cancela a autorização sozinho.
- Não há como forçar uma transação a cair em Review.

**Webhook** (`/api/webhooks/braspag`)
- Trata só `ChangeType === 1`. O resto era descartado com `console.log` e 200.

### Decisões

1. **O `if` de decisão não usa o status normalizado.** *(Substituída na A2a,
   decisão 1.)*
   `fraudStatusParaDecisao` devolve o número cru e `undefined` para qualquer
   outra coisa. Com o cast antigo, só o **número** 1 aprovava. Se o `if` lesse o
   valor normalizado, `"1"` ou `"Accept"` como texto passariam a capturar — seria
   mudança de comportamento. A normalização serve só para registro e rótulo.
   Os testes provam a equivalência para os seis valores, variantes em texto e
   bloco ausente. O teste de mutação (trocar pela normalizada) reprova 5 casos.

2. **Chaves próprias sob `af:` no KV, sem índice de pagamentos.**
   - `af:contagem:<AAAA-MM-DDTHH>`: hash por hora, 8 dias.
   - `af:eventos`: últimos 200 resultados.
   - `af:webhooks-nao-tratados`: últimos 100.
   - `af:voids-sem-sucesso`: últimos 100.

   Não toca `draft:*`, authlog nem órfãos. Toda escrita engole a própria falha:
   Redis fora do ar não derruba cobrança.

3. **O resultado do antifraude só é registrado quando a autorização passou**
   (ou quando o bloco veio). Com AuthorizeFirst/OnSuccess, uma recusa do emissor
   não tem análise; registrá-la inflaria o Unknown.

4. **Registros redigidos na gravação** (`redigirParaRegistro`). Chaves sensíveis
   (cartão, CVV, nome, e-mail, CPF, telefone, endereço) e padrões de PAN, CPF e
   e-mail dentro de textos. O PaymentId (GUID) é preservado de propósito: o
   separador hífen ficou fora da regra de PAN porque transformava os grupos do
   GUID num "cartão".

5. **Webhook: tudo o que cai no ramo "ignorado" é persistido.** Isso inclui
   ChangeType diferente de 1, ausência de PaymentId e corpo que não é JSON. O
   corpo passa a ser lido como texto e só depois convertido, com resultado
   equivalente ao `req.json().catch()` anterior. Headers: lista fechada, nunca
   `authorization` nem cookie.

6. **Void conferido.** Status diferente de 10, ou exceção, gera:
   - log `[Braspag:VoidSemSucesso]`;
   - registro em `af:voids-sem-sucesso`;
   - nota no e-mail de alerta interno.

   O hóspede recebe a mesma resposta de antes.

7. **Rótulo do alerta** vem de `rotuloFraudStatus(valor cru)` e nunca imprime
   "undefined". Texto interno, não é comportamento.

8. **Observabilidade em rota JSON, sem página.** `GET /api/admin/antifraude`
   com `Authorization: Bearer <ADMIN_API_TOKEN>`. A variável já existe na
   Vercel de produção. Token só por header; resposta 404 sem ele.

### Pendências para as próximas rodadas

**A2**
- Parar de dar void quando o status for Review. Introduzir o estado de
  aguardando análise.
- O TTL do draft na `main` é 2h, menor que a janela de revisão de 4h: um draft
  em análise expiraria antes da decisão. Na linhagem da galeria são 24h.
- `blockCalendarNight` não tem operação inversa. O desbloqueio precisa ser
  escrito, não só chamado.

**A3**
- Agir sobre a notificação que carrega a decisão do antifraude. Qual
  ChangeType é esse sairá de `af:webhooks-nao-tratados`.

**Antes de mergear a linhagem da galeria**
- O fallback para a Cielo dispara em `fraudStatus !== 1`, o que inclui Reject
  e Review. É uma rota de contorno do antifraude: reenvia para um gateway sem
  Cybersource o que o Cybersource recusou ou mandou revisar. O fallback precisa
  separar falha técnica (Unknown, Aborted, Unfinished, timeout) de decisão
  (Reject, Review). Só o primeiro grupo justifica fallback.

### Achados fora de escopo (não corrigidos)

1. **Chave de acesso fixa no código-fonte.** As rotas `src/app/api/debug/channels`
   e `src/app/api/debug/hostaway-reservation` estão em produção protegidas por
   uma chave escrita no próprio arquivo, e o repositório é público. A correção
   (`ADMIN_API_TOKEN`) existe na linhagem não mergeada (commit `b8e5192`).
2. **`/api/payments/braspag/authlog` recebe o segredo por query string.** Ele
   vai parar em log de acesso e histórico de navegador.
3. **Webhook ignora `ChangeType: "1"` enviado como texto.** A comparação é
   estrita com o número 1. Se a Braspag mandar texto, a confirmação de Pix por
   webhook se perde (o reconcile diário cobre). A partir da A1 isso aparece em
   `af:webhooks-nao-tratados`.
4. **Webhook com corpo JSON `null` responde 500.** A desestruturação lança e a
   Braspag reenvia. Mantido igual nesta rodada.
5. **`voidBraspagPayment(auth.paymentId!)`.** Sem PaymentId, a URL vira
   `/v2/sales/undefined/void`. A partir da A1 isso é registrado como void sem
   sucesso.
6. **Webhooks reenviados duplicam a entrada em `af:webhooks-nao-tratados`.** O
   registro acontece antes da deduplicação, e a contagem por ChangeType conta
   entregas, não eventos únicos.
7. **ESLint não está configurado na `main`.** Não há `.eslintrc` nem
   dependência de ESLint, e `next lint` abre o assistente de configuração. O
   build só confere tipos.
