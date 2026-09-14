# DECISOES

Registro de decisões e fatos apurados. Criado na rodada A1, sobre a `main`.

> A branch de galeria (`feat/galeria-cloudinary`) e as anteriores têm um
> `DECISOES.md` próprio, ainda não mergeado. Quando elas entrarem, os dois
> arquivos precisam ser unidos à mão.

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

1. **O `if` de decisão não usa o status normalizado.**
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
