# Gateway: Braspag restabelecido

O gateway de produção voltou a ser a **Braspag**, e os bloqueios anteriores eram
configuração do lado deles — já resolvida.

## O que estava acontecendo

Pagamentos acima de R$ 2.000 eram recusados com `FraudAnalysisStatus 2` e
`ReasonCode 481`, enquanto valores baixos passavam com `ReasonCode 100`. O corte
era valor, não pacote, não parcelamento e não score — havia score 30 aprovado e
score 5 recusado.

`481` na Cybersource é rejeição por **regra do Decision Manager**, configurada no
perfil da conta. Nada no nosso código produzia ou contornava isso.

Evidência que isolou a variável, mesma cartão e mesmo dia:

| PaymentId | Valor | Origem | ReasonCode | Score | Resultado |
|---|---|---|---|---|---|
| `f78681d4` | R$ 50 | avulso | 100 | 4 | aprovado |
| `53320ce7` | R$ 2.060 | avulso | 481 | 52 | recusado |

O detalhamento completo está em `antifraude-recusa-por-valor.md`, que fica como
registro do chamado.

## Situação atual

Resolvido pela Braspag. `PAYMENT_PROVIDER=braspag` em produção, verificável a
qualquer momento:

```bash
curl https://www.solariummantiqueira.com/api/payments/provider
```

Resposta esperada: `{"provider":"braspag","sandbox":false}`. Se vier **503**, a
variável sumiu do ambiente — desde a rodada 10 o código falha explícito em vez de
cair na Cielo em silêncio, que foi como três reservas de teste rodaram no gateway
errado sem ninguém perceber.

## O que continua valendo

- Nenhuma regra de antifraude, captura, void ou liberação manual foi alterada em
  nenhuma rodada
- O authlog guarda as 200 últimas tentativas por 7 dias, com `ProviderReturnCode`,
  `ProviderReturnMessage`, `FraudAnalysisReasonCode`, `FraudScore` e `errorBody`
- Recusa de pagamento de pacote dispara alerta interno com assunto
  `⚠️ PAGAMENTO DE PACOTE RECUSADO` e o diagnóstico completo

Se voltar a aparecer recusa por valor, o primeiro lugar a olhar é o
`FraudAnalysisReasonCode` no authlog: `481` significa que a regra voltou.
