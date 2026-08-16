# Reservas de teste — Pacotes V2

## RESERVAS CRIADAS — PENDENTES DE ESTORNO

Três reservas reais em produção. **Nenhuma pode ficar em aberto.**

| Hostaway | Datas | Casa | Pacote | Gateway | Estornada em | Cancelada na Hostaway |
|---|---|---|---|---|---|---|
| **64795274** | 25–27/09/2026 | Solarium 1 | Fim de Semana Completo | Cielo | ______ | ______ |
| **64795452** | 20–23/11/2026 | Solarium 1 | Feriado na Serra | Cielo | ______ | ______ |
| **64812668** | ______ | ______ | ______ | Cielo | ______ | ______ |

**As três rodaram na Cielo, não na Braspag.** O Preview não tinha
`PAYMENT_PROVIDER` e o código caía na Cielo por omissão — corrigido na rodada 10,
que agora falha explícito. O estorno é pelo portal **Cielo**, não Braspag.

Consequência: o fluxo de pacote **ainda não foi exercido** contra 3DS, antifraude
Cybersource nem captura separada. Repetir os testes com `PAYMENT_PROVIDER=braspag`
confirmado em `/api/payments/provider` antes de começar.

**Atenção ao cancelar:** as duas primeiras têm late check-out incluso e a noite do
dia de check-out **não foi bloqueada** (bug corrigido na rodada 9). Verificar se
alguma dessas noites foi vendida antes de liberar o calendário:

- 27/09/2026 (Solarium 1)
- 23/11/2026 (Solarium 1)

---

## CAMPOS CUSTOMIZADOS A CRIAR NA HOSTAWAY

O log traz `[Hostaway:customFields] nenhum campo compatível na conta`. O código já
os preenche assim que existirem, e continua escrevendo tudo no `hostNote` de
qualquer forma — o `hostNote` não será removido.

Criar em **Settings → Custom Fields**, tipo **Text**, escopo **Reservation**:

| Nome do campo | Tipo | O que recebe |
|---|---|---|
| `Pacote` | Text | Nome do pacote, ex.: `Fim de Semana Completo` |
| `Extras` | Text | Itens com quantidade e valor, um por linha |
| `Cancelamento de extras` | Text | Data-limite em ISO, ex.: `2026-09-18` |

O código aceita nomes alternativos, caso a conta já tenha algo parecido:
`Package` para o primeiro, `Extras a providenciar` para o segundo, e
`Data limite cancelamento extras` para o terceiro. Qualquer um dos dois nomes
serve; não é preciso criar os dois.

---

Registro das reservas criadas em produção para validar o fluxo, **e do estorno de
cada uma**. Braspag e Hostaway são de produção: todo teste move dinheiro real e
ocupa calendário real.

## Antes de começar

1. `NEXT_PUBLIC_PACOTES_V2=true` e `RESERVA_TESTE=true` no ambiente, seguido de
   **redeploy**. Sem o redeploy a variável não vale.
2. Confirmar que `RESERVA_TESTE` está pegando: o hóspede da reserva nasce com o
   prefixo `[TESTE]` e o alerta interno chega com `[TESTE]` no assunto. Se não
   aparecer, **pare** — a reserva vai se misturar com as reais.
3. Escolher datas de **baixa demanda**. A noite fica bloqueada na Hostaway até o
   cancelamento.
4. Cartão real, em valor real. O estorno é feito depois, pelo portal Braspag.

## Como anotar

Preencha `Cobrado` com o valor que apareceu na fatura, não com o da tela. A
diferença entre as duas colunas é exatamente o que estes testes existem para
encontrar.

---

## 1. Fim de Semana Completo

**Caminho:** `/pacotes` → Fim de Semana Completo → check-in numa sexta → 2 hóspedes

| Passo | Esperado na tela |
|---|---|
| Escolher sexta | Check-out preenche sozinho no domingo, sem edição |
| Escolher uma terça | CTA bloqueado, com o motivo escrito |
| Linhas de preço | Estadia · Check-out estendido **850** · Cesta Café Café **180** |
| `Valor total` | soma exata das linhas acima |
| `TOTAL DO PACOTE` | `Valor total` − desconto |
| Economia | igual a `Valor total` − `TOTAL` |
| Remover a cesta | some da lista e do `Valor total`; bônus permanece |

| | Tela | Cobrado |
|---|---|---|
| Total | | |
| Pix | | |

**Reserva:** id Hostaway ___ · PaymentId ___ · data ___ · **estornada em** ___

---

## 2. Meio de Semana na Serra

**Caminho:** `/pacotes` → Meio de Semana → check-in seg/ter/qua → 2 hóspedes

| Passo | Esperado na tela |
|---|---|
| Escolher uma sexta | CTA bloqueado |
| Seletor de hóspedes | presente (paridade) |
| `PERSONALIZE SUA ESTADIA` | presente, **sem cestas de café** — o pacote já traz 3 |
| Adicionar lenha | total sobe exatamente R$ 60 |
| Preço do pacote | inalterado em relação a hoje |

| | Tela | Cobrado |
|---|---|---|
| Total | | |

**Reserva:** id Hostaway ___ · PaymentId ___ · data ___ · **estornada em** ___

---

## 3. Imersão na Serra

**Caminho:** `/pacotes` → Imersão → 4 noites de semana → 2 hóspedes

| Passo | Esperado na tela |
|---|---|
| Seletor de hóspedes e bloco de extras | presentes |
| Subir para 3 hóspedes | estadia sobe R$ 100 × noites |
| Preço do pacote | inalterado em relação a hoje |

| | Tela | Cobrado |
|---|---|---|
| Total | | |

**Reserva:** id Hostaway ___ · PaymentId ___ · data ___ · **estornada em** ___

---

## 4. Feriado na Serra

**Caminho:** `/pacotes` → Feriado na Serra → check-in quinta ou sexta com feriado

| Passo | Esperado na tela |
|---|---|
| Janela sem feriado | pacote **não aparece** na grade |
| 12–15/11/2026 | **não abre** — feriado de domingo não gera emenda |
| 19–22/11/2026 | abre — Consciência Negra cai numa sexta |
| Check-out no domingo, noite seguinte livre | bônus de saída aplicado |
| Check-out no domingo, noite seguinte ocupada | sem bônus, total maior |

| | Tela | Cobrado |
|---|---|---|
| Total | | |

**Reserva:** id Hostaway ___ · PaymentId ___ · data ___ · **estornada em** ___

---

## 5. Dois Casais, Uma Vista

**Caminho:** `/pacotes` → Dois Casais → 2 noites → hóspedes começa em 4

| Passo | Esperado na tela |
|---|---|
| Seletor de casa | **ausente** — é sempre o Completo |
| Hóspedes | mínimo 4, máximo 8 |
| 4 hóspedes vs 2 | **mesmo total**; a taxa aparece e sai como cortesia |
| 5 hóspedes | total sobe (uma taxa, já com o progressivo aplicado) |
| Cesta inclusa | exibida como **×2**, uma por casa |
| Remover o late | sai da lista, e o bônus sai junto no mesmo recálculo |
| Estadia seg→qua | late exibido a **1.000**, não 1.600 |

| | Tela | Cobrado |
|---|---|---|
| Total com 4 | | |
| Total com 5 | | |

**Reserva:** id Hostaway ___ · PaymentId ___ · data ___ · **estornada em** ___

---

## 6. Extra já incluso — teste de cobrança duplicada

**O teste mais importante da lista.** Era um bug de cobrança a maior: o checkout
oferecia o check-out estendido que o pacote já incluía, e adicionar cobrava as
duas vezes.

**Caminho:** Fim de Semana Completo → `RESERVAR PACOTE` → tela de dados

| Passo | Esperado |
|---|---|
| Bloco de extras do checkout | **não** oferece Check-out estendido nem Cesta Café Café |
| Total do checkout | idêntico ao da página do pacote, sem salto |
| `Valor total` | depois de todas as linhas, imediatamente antes do `TOTAL` |
| Rótulo `Valor à la carte` | não existe em tela nenhuma |

**Forçando pela URL** — cole no navegador trocando as datas, e confirme que o
servidor recusa em vez de somar:

```
/reservar?propertyId=solarium-1&checkin=AAAA-MM-DD&checkout=AAAA-MM-DD&guests=2&pacote=fim-de-semana-completo&extras=late_checkout
```

| | Esperado | Observado |
|---|---|---|
| Ao enviar o formulário | recusa: `Este pacote já inclui: …` | |
| Total | **não** aumenta em R$ 550 | |

Repetir com `extras=cesta_cafecafe` e, no Dois Casais, com
`extras=late_checkout` e `extras=cesta_cafecafe`.

---

## 7. Verificações que valem para todas

| Item | Onde conferir |
|---|---|
| Extras chegaram à equipe | alerta interno com bloco `EXTRAS A PROVIDENCIAR` |
| Data-limite de cancelamento | no alerta e no `guestNote` da reserva, por extenso |
| Reserva marcada como teste | `[TESTE]` no nome do hóspede e no assunto do alerta |
| Cupom recusado | tentar qualquer código num pacote → recusa server-side |
| Mobile | resumo legível sem rolagem horizontal |

---

## Estorno

Nenhuma reserva de teste pode ficar em aberto. Para cada uma:

1. Estornar no portal Braspag e anotar a data acima
2. Cancelar a reserva na Hostaway, liberando a noite
3. Conferir que a noite voltou ao calendário

**Cheque final:** nenhuma linha deste documento pode ficar com `estornada em`
vazio depois de encerrada a rodada de testes.
