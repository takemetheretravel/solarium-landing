# Pacotes V2 — decisões e racional comercial

Documento interno. Nada aqui pode virar comentário de código: o repositório é público.

Última revisão: 13/08/2026 · Branch `feature/pacotes-v2` · Flag `NEXT_PUBLIC_PACOTES_V2`

---

## 1. Base do desconto progressivo (revisão 2.1)

O progressivo incide sobre:

```
base_desconto = total Hostaway (diárias + hóspede extra + limpeza)
              + early check-in + late check-out
```

Cestas, massagem, decoração, tábua, fondues e lenha entram no subtotal a preço cheio e **não**
recebem desconto.

**Por quê.** Os itens operacionais são margem nossa — a noite bloqueada é custo de
oportunidade, não custo de fornecedor. Os demais extras são repasse: dar desconto sobre eles
corrói margem de terceiro sem ganho de conversão. A base escolhida é a maior sobre a qual
conseguimos ser generosos sem pagar para vender.

**Consequência.** O desconto de um pacote cresce quando o hóspede traz mais gente ou estende
a estadia, e fica estável quando ele só adiciona comida. É o incentivo certo: queremos
ocupação, não ticket de cesta.

## 2. Onde o dinheiro do pacote realmente sai

No fluxo avulso o progressivo incide **só** sobre o total Hostaway, e todo extra — inclusive
early e late — é somado depois, sem desconto. É essa diferença de base que o pacote captura.

Fim de Semana Completo, baixa temporada:

| | Avulso | Pacote |
|---|---|---|
| Diárias | 3.400 | 3.400 |
| Late check-out | 550 | 550 |
| Cesta | 180 | 180 |
| Base do desconto | 3.400 | 3.950 |
| Progressivo (8%) | −272 | −316 |
| Bônus de saída | — | −350 |
| **Total** | **3.858** | **3.460** |

Economia: **R$ 398**. Calculada em runtime pela mesma função nos dois lados, nunca escrita à
mão. Exibida em reais, nunca em percentual.

Os dois lados usam o mesmo preço de menu do late check-out, e há teste que trava essa
igualdade — foi exatamente aí que a versão anterior superestimava a economia.

## 3. Bônus de saída — alteração frente à especificação

A especificação limitava o bônus a check-out no domingo. Foi generalizado para o critério
econômico real: **o bônus paga a noite que dificilmente seria vendida.**

Aplica quando as três condições valem: late check-out ativo, noite seguinte livre, e check-out
em domingo **ou** em segunda com feriado na estadia.

Efeito colateral aceito: o exemplo de feriado sex–seg passa de 6.600 para 6.250, igualando o
qui–dom. Decisão do dono, registrada.

Sem late check-out não há bônus em nenhuma hipótese — o bônus existe porque a noite já está
bloqueada pelo late. Removido o late no Dois Casais, o bônus sai no mesmo recálculo.

## 4. Solarium Completo — D-1

A tarifa permanece exatamente como está na Hostaway. A margem menor frente a duas reservas
separadas é conhecida e aceita: **a restrição do negócio hoje é ocupação, não margem.** Um
grupo fechando as duas casas é resultado desejado.

Bônus do Completo: **R$ 350**, igual ao das casas individuais. R$ 700 empilharia concessão
sobre um produto de margem já reduzida.

## 5. Pessoa adicional — cobrança em um lugar só

A Hostaway já cobra hóspede adicional nas três listings: `guestsIncluded = 2`,
`priceForExtraPerson = 100` por pessoa por noite. O site já repassa isso dentro do total da
estadia.

O extra "Pessoa adicional" de R$ 200 da especificação **foi descartado**. Cobrá-lo somaria
R$ 300/pessoa/noite. O item existe no catálogo como informativo, fora do subtotal, exibindo o
valor real da Hostaway.

Para mudar o valor, muda-se na Hostaway. Alterar tarifa lá está fora do escopo desta fase.

## 6. Preço do late check-out dentro do pacote — RESOLVIDO

**O pacote usa o mesmo preço do fluxo avulso.** Decisão do dono, definitiva: fim de semana só
quando a noite bloqueada cai em sexta ou sábado.

Nos três pacotes afetados o late check-out incluso vale **R$ 550**, não 850:

| Pacote | Noite bloqueada | Preço de menu |
|---|---|---|
| Fim de Semana Completo | domingo | 550 |
| Feriado na Serra qui–dom | domingo | 550 |
| Feriado na Serra sex–seg | segunda | 550 |
| Dois Casais (saída sábado) | sábado | 1.600 |
| Dois Casais (saída domingo) | domingo | 1.000 |

Dois Casais não mudou: já resolvia fds/semana corretamente.

O toggle `USAR_PRECO_OPERACIONAL_REAL` foi **removido** — virou comportamento fixo. A tabela
de valores segue centralizada em `precoMenuOperacional()`, então 550/850/1000/1600 não
aparecem repetidos em lugar nenhum.

**Como isso passou despercebido antes.** Os golden tests originais montavam as linhas de
preço à mão, com 850 escrito no teste, em vez de chamar `montarItens()`. O código de produção
já calculava 550; o teste é que não olhava para ele. Os golden tests agora passam pelo mesmo
caminho do servidor, e há um teste explícito travando que os dois lados da economia usem o
mesmo preço de menu.

## 7. Cupom não combina com pacote

Sem exceção e sem porta dos fundos:

- o campo de cupom não é renderizado na página de pacote;
- o draft rejeita a requisição inteira quando chega `pacoteId` junto de `couponCode`;
- não existe código de operador nem bypass.

O preço do pacote é fixo e não há margem adicional para negociação. Construir um override
seria construir a pressão para usá-lo.

## 8. Piso de 8% no Dois Casais — removido

A estadia mínima é 2 noites e 2 noites já retornam 8% na tabela progressiva. O piso era código
morto e fonte futura de bug.

## 9. Feriados — dependência não resolvida

`info_datas`, a base da Fernanda, **não é acessível a partir do site**. Não existe endpoint,
não existe referência no repositório.

A tabela `FERIADOS_NACIONAIS` em `config/precos-e-extras.ts` é a fonte única hoje. Cobre
**apenas 2026**. Há um teste que falha o build quando o ano corrente ultrapassa a cobertura —
sem ele, o pacote Feriado na Serra ficaria cego em silêncio.

A interface de leitura está isolada para trocar por `info_datas` sem tocar em quem consome.

## 10. Cancelamento de extras — a colisão dos dois "7 dias"

A política da estadia diz "7 dias após a confirmação". A política dos extras diz "7 dias antes
do check-in". Mesmo número, âncoras opostas, na mesma tela.

Resolvido escrevendo sempre a **data**, nunca a regra: "até 14 de setembro". A data é gravada
no draft e na reserva (`dataLimiteCancelamentoExtras`) para a equipe não recalcular.

A faixa entre 7 e 5 dias antes do check-in permite contratar decoração que já nasce sem
reembolso. Não é erro, mas não pode ser surpresa: o aviso aparece no item, no momento da
seleção.

## 11. Como julgar o resultado em 60 dias

A restrição declarada do negócio é ocupação. Ticket médio sozinho não responde nada.

Ler contra:

1. **Taxa de ocupação do Solarium Completo** — é o alvo do Dois Casais, Uma Vista.
2. **Noites vendidas de segunda a quinta** — é o alvo do Meio de Semana.
3. Ticket médio e anexação de extras, como contexto.

Um pacote que aumenta ticket e não move ocupação falhou no que foi contratado para fazer.

## 12. Migração do Meio de Semana e da Imersão para o motor V2 (rodada 20)

Os dois viviam no motor antigo. A consequência não era estética: `/api/pacotes/preco`
respondia 404 para eles e a busca não os sugeria — dois dos seis pacotes fora do canal de
venda.

A migração foi feita **sem alterar preço**, e isso é verificável: 24 totais foram gerados do
motor antigo antes da mudança e travados em `migracao-legado.test.ts`. O motor V2 reproduz os
24 exatamente. Bate porque as duas fórmulas coincidem quando a soma dos itens é múltipla de
dez: o antigo arredondava a estadia e somava os itens; o novo soma tudo e arredonda no fim.

Regras traduzidas, não reescritas:

- "todas as noites de segunda a quinta" virou dia de chegada (`checkinDows`), que para uma
  duração fixa diz exatamente a mesma coisa;
- a lista de janelas bloqueadas saiu de `config/packages.ts` e virou `JANELAS_BLOQUEADAS` em
  `precos-e-extras.ts`, com os mesmos intervalos e uma fonte só;
- o quadriciclo entrou no catálogo de extras com `somenteEmPacote`, para o preço morar onde
  moram todos os outros sem virar item de venda avulsa.

O que sobrou no motor antigo é a Data Especial, que não está na grade.

Link antigo com `?package=` para um pacote migrado continua valendo: o checkout converte para
`?pacote=`. Sem isso, um link já enviado pelo atendimento abriria a preço cheio, em silêncio.

## 13. O que impede a saída em 02/01 não é o nosso código

A chegada em 28, 29 e 30/12 tem **mínimo de noites na Hostaway** de 6, 5 e 4 respectivamente.
A saída no sábado 02/01 dá 5, 4 e 3 noites — abaixo do mínimo em todos os casos, e a Hostaway
recusa a cotação. As regras do pacote aceitam as nove combinações; o teste
`final-de-ano.test.ts` prova isso.

Enquanto o mínimo estiver como está, a saída de sábado só volta a ser vendável mudando o
`minimumStay` dessas três datas no PMS. É decisão de tarifa, não de código.

O que o código passou a fazer: dizer a verdade. Antes qualquer recusa da Hostaway virava "erro
técnico"; agora o mínimo de noites aparece com o número, e o varredor de datas livres não
sugere data cujo mínimo a estadia não cumpre.

## 14. Vender abaixo do mínimo de noites do PMS (rodada 21)

O mínimo de noites é regra de canal, configurada por data no PMS. Decisão do dono:
no canal direto, dentro do pacote Final de Ano, ele não se aplica.

Antes de ligar, foi verificado na API real — não por leitura de documentação. Uma
reserva de teste (`65058672`, 28/12 → 02/01, mínimo 6 noites na chegada) foi
criada, **aceita**, bloqueou as cinco noites no calendário, e depois cancelada
com o calendário voltando a livre. Se a criação tivesse sido recusada, o bypass
seria inviável: o cliente pagaria e a reserva falharia.

O bypass é `ignorarMinimoPMS`, por pacote, e está ligado **só** no Final de Ano.
Reserva avulsa e os outros cinco pacotes continuam respeitando o mínimo. A tarifa
segue vindo inteira do calendário da Hostaway — o que muda é a recusa, não o preço.

## 15. O preço tinha dois donos, e um deles esquecia o sábado

Ao conferir as nove combinações do Final de Ano contra a API real, a saída de
sábado 30/12 → 02/01 saiu por 8.590 quando a regra do pacote dá 9.060.

Causa: `calcularPacoteServer` montava o resultado por conta própria em vez de
chamar `totalDoPacote`, e nessa montagem não passava o ajuste de taxa por dia de
saída. O varredor do "a partir de" aplicava os 5 pontos; a tela do pacote, a API
e o draft não. O teste da rodada 20 passava porque exercitava o varredor.

Agora existe uma função só que monta itens, bônus e ajuste. O teste de paridade
compara os dois caminhos nas nove combinações — se voltarem a divergir, quebra.

## 16. Chegada no domingo: a regra é sobre as noites

Migrar "todas as noites de segunda a quinta" para `checkinDows` foi errado, e o
relatório da rodada 20 chamou a tradução de idêntica. Não é: a chegada de domingo
é dia de semana e ocupa a noite de domingo.

Ao corrigir, o motor antigo foi lido de novo. O `weekdaysOnly` dele testava
**apenas sexta e sábado** — domingo passava no legado também, contra a própria
copy do produto ("noites de segunda a quinta"). Ou seja: a chegada de domingo não
nasceu na migração, ela é anterior; a migração a preservou junto com o preço.

A regra agora é `noitesProibidasDow: [5, 6, 0]`, verificada noite a noite, e
`checkinDows` desses dois pacotes é `null` — uma descrição só. Resultado:

- Meio de Semana (3 noites): chegada segunda ou terça;
- Imersão (4 noites): chegada segunda.

Dez das 24 linhas da tabela de referência têm chegada no domingo. Continuam no
teste, com o preço conferido e a elegibilidade afirmada como recusada: o valor
delas nunca esteve errado, a data é que deixou de ser vendável.
