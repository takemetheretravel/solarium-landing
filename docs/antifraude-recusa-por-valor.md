# Recusa do antifraude por valor — evidência para o chamado com a Braspag

**Conclusão: é regra do Decision Manager da Cybersource, não é o nosso código.**

Este documento existe para o chamado. Não há correção do nosso lado — a decisão é
tomada pelo antifraude, com base numa regra que não temos como ver nem alterar
pelo código.

## O que a evidência mostra

O corte é **valor**. Não é pacote, não é parcelamento, não é score.

| PaymentId | Valor | Parcelas | Origem | FraudAnalysisStatus | ReasonCode | Score | Resultado |
|---|---|---|---|---|---|---|---|
| `f78681d4` | R$ 50 | 1x | avulso | 1 (Accept) | 100 | 4 | aprovado |
| `53320ce7` | R$ 2.060 | parcelado | **avulso** | 2 (Reject) | **481** | 52 | recusado |

As duas com o **mesmo cartão**, em produção, com meia hora de diferença.

### Por que isso descarta as hipóteses anteriores

**Não é o pacote.** A transação de R$ 2.060 recusada é de reserva **avulsa**, sem
`pacoteId`, pelo mesmo caminho de código que aprovou a de R$ 50.

**Não é o parcelamento.** O padrão no authlog é: acima de R$ 2.000 recusa com
ReasonCode 481; abaixo aprova com 100 — independentemente do número de parcelas.

**Não é limiar de score.** Há transação com **score 30 aprovada** e **score 5
recusada**. Se fosse corte por score, a ordem seria monotônica; não é.

**Não é descasamento 3DS.** Essa era a hipótese da rodada 13, formada quando só
existiam duas amostras e a de maior valor era a única de pacote. A transação
avulsa de R$ 2.060 recusada quebra a correlação: mesmo caminho, mesmo código,
mesma coincidência de valor e parcelas entre init e autenticação.

### ReasonCode 481

Na Cybersource, **481 = rejeitado pelo Decision Manager**, ou seja, por uma regra
de perfil configurada na conta — não por falha técnica, não por dado ausente,
não por score bruto. O `100` das aprovadas é "sem violação de regra".

## O que pedir à Braspag

1. Qual regra do Decision Manager dispara o ReasonCode 481 nesta conta
2. Se há limite de valor por transação configurado no perfil, e qual
3. Qual o caminho para ajustar esse limite para o ticket real do negócio —
   estadias de R$ 2.000 a R$ 6.000 são o produto, não a exceção
4. Se o perfil aplicado é o correto para MCC 7011 (hospedagem)

Levar os dois PaymentIds acima: eles isolam a variável, porque só o valor muda
entre uma aprovação e uma recusa com o mesmo cartão no mesmo dia.

## Impacto enquanto não resolver

**Nenhuma reserva acima de R$ 2.000 passa no cartão** — nem avulsa nem de pacote.
Como quase toda estadia do Solarium está acima disso, na prática o cartão está
inoperante para o ticket real.

O Pix não passa por antifraude e segue funcionando.

## O que NÃO foi alterado

Nenhuma regra de antifraude, captura, void ou liberação manual foi tocada. O
diagnóstico é de configuração externa; mexer no nosso lado só esconderia a causa.
