# Rodada A1 — Observabilidade do antifraude

**Base:** `main` (produção) · **Branch:** `feat/a1-observabilidade-antifraude`

## Resumo

A Cybersource ativou Revisão Manual de 4h neste MerchantId. Esta rodada **não
muda nenhuma decisão de pagamento**: só lê, tipa, persiste e registra, para
medirmos em produção o que acontece com Review, webhooks e voids antes da A2.

## O que entra

1. **Parse defensivo do `FraudAnalysis.Status`** (`src/lib/braspag.ts`)
   - `normalizarFraudStatus`: aceita número, `"3"`, `"Review"` em qualquer
     caixa; ausente ou desconhecido vira Unknown (0). Nunca lança.
   - O `if` de decisão continua recebendo o número cru
     (`fraudStatusParaDecisao`). Usar o valor normalizado faria `"1"` e
     `"Accept"` em texto passarem a capturar, o que seria mudança de
     comportamento.
2. **Persistência** (`src/lib/kv-store.ts`)
   - Chaves próprias `af:*`: contagem por hora, últimos resultados, webhooks
     ignorados e voids sem sucesso.
   - Não mexe em `draft:*` nem no authlog.
   - Falha de Redis não propaga.
3. **Webhook** (`src/app/api/webhooks/braspag/route.ts`)
   - Toda notificação ignorada é persistida já redigida: ChangeType diferente
     de 1, sem PaymentId ou corpo que não é JSON.
   - Continua respondendo 200 e sem agir.
4. **Void conferido** (`src/app/api/payments/braspag/credit/route.ts`)
   - Status diferente de 10, ou exceção, gera log `[Braspag:VoidSemSucesso]`,
     registro no KV e nota no alerta interno.
   - O hóspede recebe a mesma resposta.
   - O rótulo do alerta deixa de imprimir "sem retorno (undefined)".
5. **Leitura** (`src/app/api/admin/antifraude/route.ts`)
   - Rota `GET /api/admin/antifraude` com `Authorization: Bearer <ADMIN_API_TOKEN>`
     (a variável já existe em produção). Responde 404 sem token.
   - Traz contagem por status em 24h e 7d, webhooks ignorados por ChangeType,
     voids sem sucesso e os registros mais recentes.
6. **DECISOES.md** com os fatos do A0, as decisões e os achados fora de escopo.

## Fora de escopo (de propósito)

- Não para de dar void em Review e não cria estado de análise (A2).
- Não age sobre webhooks ignorados (A3).
- Não mexe em telas, no fallback para Cielo nem em `src/lib/cielo.ts`.

## Verificação

- `vitest run`: **131 testes passando** (84 existentes + 47 novos em
  `src/lib/braspag-antifraude.test.ts`).
  - Parse: número, `"3"`, Review nas três caixas, ausente, fora do enum.
  - Equivalência: a rota de crédito real, com o gateway simulado, captura só
    com o número 1. Para 0, 2, 3, 4, 5, `"1"`, `"Accept"`, `"Review"` e bloco
    ausente, dá void e responde 402 com o mesmo corpo de antes.
  - Mutação: trocar a decisão pelo valor normalizado reprova 5 testes.
  - KV: draft e authlog pré-existentes ficam intactos; contagem por janela;
    Redis fora do ar não propaga.
  - Webhook com ChangeType desconhecido é persistido e responde 200.
  - Nenhum registro `af:*` contém PAN, CVV, nome, e-mail ou CPF, inclusive
    quando vêm no corpo do webhook ou na mensagem de exceção do void.
- `tsc --noEmit`: limpo.
- `next build`: limpo.
- Lint: não configurado na `main` (ver achado 7 no DECISOES).

## Como conferir no preview

1. Chamar `GET /api/admin/antifraude` com o Bearer. A resposta deve vir com
   janelas zeradas.
2. Enviar um `POST /api/webhooks/braspag` com `{"PaymentId":"<guid>","ChangeType":3}`.
   Deve responder 200 e aparecer em `ultimosWebhooksNaoTratados` e na contagem.

## Riscos

- Latência: cada autorização ganha uma ida ao Redis (pipeline único).
- Webhooks reenviados duplicam a entrada na lista de ignorados. A contagem é
  por entrega.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
