# Observação das primeiras 24 horas — Pacotes V2 em produção

A decisão foi ir ao ar sem teste isolado: o primeiro cliente real é o teste. Isso
só funciona se uma falha **não passar em silêncio**. Este documento é o que
transforma essa aposta em risco controlado.

---

## REVERSÃO — leia primeiro, antes de precisar

**Menos de cinco minutos, sem deploy de código.**

1. Vercel → projeto → **Settings → Environment Variables**
2. Localizar `NEXT_PUBLIC_PACOTES_V2` no escopo **Production**
3. **Remover** a variável (ou trocar o valor para `false`)
4. **Deployments → o último de Production → ⋯ → Redeploy**
5. Confirmar: `https://www.solariummantiqueira.com/pacotes` volta a responder **404**

Não precisa reverter commit, não precisa mexer em `main`. A flag desligada
reproduz o site de hoje — isso foi verificado a cada rodada comparando o texto
renderizado com a produção.

**Quando reverter sem pensar duas vezes:**

- Qualquer cobrança com valor diferente do exibido na tela
- Reserva criada sem bloqueio da noite seguinte, com late check-out ativo
- Duas ou mais recusas seguidas sem causa identificada no diagnóstico
- Qualquer erro no fluxo avulso, que não deveria ter sido tocado

Reverter não é derrota: é o que torna aceitável lançar sem teste isolado.

---

## O que conferir, e onde

### A cada poucas horas nas primeiras 24h

**1. Authlog — toda tentativa de cartão, aprovada ou não**

```bash
curl "https://www.solariummantiqueira.com/api/payments/braspag/authlog?secret=SEU_SEGREDO"
```

Olhar, em cada entrada:

| Campo | O que significa se estiver errado |
|---|---|
| `Status` | ≠ 1 é recusa do emissor |
| `ReturnCode` / `ReturnMessage` | motivo da recusa |
| `ProviderReturnCode` / `ProviderReturnMessage` | motivo **do provedor** — é aqui que mora a causa real |
| `FraudAnalysisStatus` | 1 aprovado · 2 Reject · 3 Review |
| `FraudAnalysisReasonCode` / `FraudScore` | por que o antifraude barrou |
| `errorBody` | corpo cru quando a requisição falhou (credencial, payload) |
| `merchantOrderId` | `<draftId>-<sufixo>`: cada tentativa tem o seu |

O log guarda as **200 últimas** tentativas por 7 dias.

**2. Caixa de e-mail dos alertas**

| Assunto | O que fazer |
|---|---|
| `⚠️ PAGAMENTO DE PACOTE RECUSADO` | **Investigar sempre.** Traz o diagnóstico completo |
| `🚨 Pagamento recusado` | Recusa de reserva avulsa — comparar com o volume normal |
| `✅ Reserva confirmada` | Conferir o bloco `EXTRAS A PROVIDENCIAR` |
| `⚠️ PAGAMENTO SEM RESERVA` | **Urgente.** Cliente pagou e não tem reserva |

**3. Hostaway, para cada reserva de pacote que entrar**

- `hostNote` tem o nome do pacote e uma linha por item?
- `guestNote` tem a data-limite de cancelamento por extenso?
- A noite seguinte ao check-out está **bloqueada**, quando há late check-out?
- O valor da reserva bate com o cobrado no cartão?

**4. Uma olhada nas telas**

- `/pacotes` lista os cinco cards com valor, nenhum em `Consultar datas`
- A home mostra o bloco de pacotes com no máximo 3 cards
- O fluxo avulso de uma casa continua funcionando

---

## Primeiras hipóteses se a reserva real falhar

Na ordem em que vale checar:

**1. Fingerprint da Cybersource entre domínios.** O `deviceFingerprintId` é
coletado no navegador e enviado ao antifraude. O script de coleta é sensível ao
domínio de origem: uma sessão iniciada em `*.vercel.app` e finalizada no domínio
próprio, ou vice-versa, pode gerar fingerprint que o antifraude não reconhece —
e devolver `Review`/`Reject` sem que a transação tenha problema.

Como produção roda em `www.solariummantiqueira.com`, o cenário misto não deveria
acontecer. Mas é a **primeira hipótese** a checar se vier `FraudAnalysisStatus`
2 ou 3 com `FraudScore` baixo: score baixo com bloqueio é sinal de dado de
dispositivo faltando, não de risco real.

Onde olhar: `FraudAnalysisReasonCode` no authlog, e se o `deviceFingerprintId`
chegou preenchido na autorização.

**2. `PAYMENT_PROVIDER` no escopo errado.** Confirmar antes de tudo:

```bash
curl https://www.solariummantiqueira.com/api/payments/provider
```

Tem que responder `{"provider":"braspag","sandbox":false}`. Se responder **503**,
a variável sumiu. Se responder `cielo`, está no gateway errado — e o fluxo não
passa por 3DS nem antifraude.

**3. Cartão do cliente.** Recusa de emissor é o caso mais comum e não é bug.
`ProviderReturnCode` distingue: saldo, limite, cartão bloqueado, dados inválidos.

---

## Comportamento esperado que NÃO é problema

**`[Webhook:Cielo] provider=CIELO (nenhum draft Braspag correspondeu)`**

Aparece em toda tentativa e é esperado. A URL de notificação cadastrada no portal
Braspag aponta para o endpoint `/api/webhooks/cielo`, que primeiro tenta casar a
notificação com um draft Braspag; não casando, segue pelo caminho Cielo. Com
pagamento de cartão, a confirmação já aconteceu de forma síncrona no `/credit`, e
o webhook não tem o que fazer.

A mensagem é ruidosa, não sintomática. **Não alterar durante a janela de
observação** — mexer em roteamento de webhook com tráfego real é trocar um
incômodo por um risco.

---

## Reservas de teste ainda pendentes de estorno

`64795274`, `64795452`, `64812668` — todas na **Cielo**, não na Braspag. Detalhes
em `reservas-teste-pacotes-v2.md`. Resolver isso não bloqueia o lançamento, mas
não pode ser esquecido.
