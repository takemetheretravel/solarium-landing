## O que muda

Três incidentes reais na rota de pagamento, todos invisíveis para a operação até alguém exportar log da Vercel à mão. Este PR não corrige nenhum deles — **torna os três visíveis**. É puramente aditivo: só acrescenta log, telemetria e notificação. Nenhum caminho de pagamento muda de comportamento.

Serve como janela de observação antes do PR do fallback automático.

## Bloco 1 — falhas visíveis

**1.1 CSP.** `/api/csp-report` recebeu 151 relatórios, respondeu 204 e descartou todos. Agora cada violação vira uma linha `[CSP:violacao]` com `disposition`, `effectiveDirective`, `blockedURL`, `documentURL`, `sourceFile`, `lineNumber`, `statusCode` e `isPaymentRoute`.

`disposition` é o que importa: separa "bloqueou de verdade e quebrou o checkout de alguém" de "só observou". Ausente resolve para `report`, nunca `enforce`. Deduplicação em memória de 60s por `disposition|diretiva|origem|isPaymentRoute` — uma campanha já gerou 147 linhas idênticas.

A rota segue **sem autenticação e fora de qualquer middleware**: quem posta é o navegador do visitante.

**1.2 Telemetria do 3DS.** Em 02/09 o mesmo dispositivo criou 8 sessões 3DS e fez **zero** chamadas de cobrança. `POST /api/payments/telemetry` registra oito etapas, responde 204 sempre e nunca lança. Timeout de **120s** a partir de `3ds_desafio_exibido`, **só como observação** — o prazo funcional de 5 min segue intocado. Sem PII.

**1.3 Notificação de falha terminal.** Só o sucesso notificava alguém. Mesmo Resend, mesmo destinatário, nenhuma dependência nova. Anti-flood de **15 min por draft** via `SET NX EX`: as 6 tentativas de 28/08 geram no máximo 2 e-mails.

## Bloco 3 — ciclo no Hostaway

**3.1** `GET /reservations/{id}/offlineCharges` responde 404 consistente. A doc dá `PUT /v1/offlineCharges/{id}` — caminho diferente do que o código assumia — mas **o schema do corpo não está publicado**. Escolha conservadora: tenta o endpoint documentado, cai para a reserva com `includeResources=1`, e não achando registra `[Hostaway:conciliacao] endpoint indeterminado`, notifica e devolve `null` (não `[]`). `null` é "não sei onde estão"; `[]` faria registrar cobrança que talvez já exista, e duplicata exige estorno.

**Impasse documentado** em `DECISOES.md` — é pergunta para o suporte, não tentativa e erro contra produção.

**3.2** Os dois crons logam `[Cron:auth]` com `header_presente`, `secret_configurado` e `match` antes do 401 — 144 de 144 execuções falharam sem diagnóstico. Só booleanos e comprimentos, nunca o segredo.

## Arquivos tocados

| Arquivo | |
|---|---|
| `src/lib/csp-normalizar.ts` | novo — parsing dos dois formatos + dedupe |
| `src/lib/telemetria-pagamento.ts` | novo — vocabulário + emissor cliente |
| `src/lib/notificar-falha.ts` | novo — porta única com anti-flood |
| `src/lib/cron-auth-log.ts` | novo — diagnóstico do 401 |
| `src/app/api/csp-report/route.ts` | passa a logar o corpo |
| `src/app/api/payments/telemetry/route.ts` | novo |
| `src/lib/email.ts` | + `enviarAlertaFalhaTerminal` |
| `src/lib/kv-store.ts` | + anti-flood, contador AF, contador de recusa |
| `src/lib/hostaway.ts` | caminho alternativo de leitura de cobranças |
| `src/app/api/payments/{credit,braspag/credit}/route.ts` | notificação em falha terminal |
| `src/app/api/{hostaway/finalizar-pagamentos,payments/braspag/pix-reconcile}/route.ts` | `[Cron:auth]` |
| `src/app/(checkout)/.../pagamento/page.tsx` | emissão de telemetria |
| `scripts/smoke.mjs` | verificação 17 |
| `docs/runbook-pagamentos.md`, `DECISOES.md` | novos/atualizados |

## Risco

**Baixo.** O único arquivo de risco real é a página de pagamento: as inserções são chamadas de telemetria em pontos existentes, sem alterar controle de fluxo, e o efeito de `pagina_abandonada` tem handler próprio — o `visibilitychange` do polling do Pix não foi tocado.

**Não toca** CSP, isolamento de scripts, navegação, layout, lógica de precificação nem os golden. Verificado por diff: `src/middleware.ts` e o layout do grupo `(checkout)` inalterados.

O `contador de bloqueios de antifraude` já entra aqui (kv-store), mas **não é lido por ninguém neste PR** — é a base do PR 2.

## Verificação

- `npm run smoke` — 17 checagens ✅ (golden 3.460 / 3.740 / 5.990 / 6.340)
- `npx vitest run` — 230 testes ✅ (11 novos: dois formatos de CSP + dedupe de 60s)
- `npm run build` ✅

## Depois do merge

O 3DS não é testável fora de produção. Confirmar em produção que `[Telemetria] … etapa=3ds_iniciado` e `[CSP:violacao]` aparecem — o runbook tem o passo a passo na seção 8.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
