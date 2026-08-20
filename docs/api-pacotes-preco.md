# `/api/pacotes/preco` — cotação de pacote

Endpoint que a página do pacote usa para calcular. A agente de atendimento pode
consultá-lo direto para cotar sem abrir o navegador.

**É a mesma função que o site usa.** O valor que sai daqui é o que o hóspede vê na
tela e o que o draft recalcula na hora de cobrar — não existe caminho paralelo.

## Requisição

```
POST https://www.solariummantiqueira.com/api/pacotes/preco
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | O que é |
|---|---|---|---|
| `pacoteId` | texto | sim | Slug do pacote: `fim-de-semana-completo`, `feriado-na-serra`, `dois-casais`, `final-de-ano` |
| `propertySlug` | texto | sim | `solarium-1`, `solarium-2` ou `solarium-completo` |
| `checkin` | texto | sim | `AAAA-MM-DD` |
| `checkout` | texto | sim | `AAAA-MM-DD` |
| `guests` | número | não | Padrão 2. No Dois Casais, mínimo 4 |
| `removidos` | lista | não | Ids de inclusos que o cliente dispensou, ex.: `["cesta_cafecafe"]` |
| `selecaoExtras` | objeto | não | Extras opcionais por id e quantidade, ex.: `{"lenha": 2}` |

### Exemplo

```bash
curl -X POST https://www.solariummantiqueira.com/api/pacotes/preco \
  -H "Content-Type: application/json" \
  -d '{
    "pacoteId": "fim-de-semana-completo",
    "propertySlug": "solarium-1",
    "checkin": "2026-09-11",
    "checkout": "2026-09-13",
    "guests": 2
  }'
```

## Resposta quando as datas fecham

```json
{
  "compativel": true,
  "total": 3460,
  "subtotal": 4430,
  "economia": 970,
  "hostawayTotal": 3400,
  "noites": 2,
  "bonusAplicado": true,
  "dataLimiteCancelamentoExtras": "2026-09-04",
  "itens": [
    { "extraId": "late_checkout", "nome": "Check-out estendido, até às 18h",
      "qtd": 1, "total": 850, "incluso": true },
    { "extraId": "cesta_cafecafe", "nome": "Cesta Café Café",
      "qtd": 1, "total": 180, "incluso": true }
  ],
  "disponiveis": [ /* extras que dá para acrescentar nestas datas */ ]
}
```

| Campo | O que significa |
|---|---|
| `total` | **O valor a informar ao cliente.** Já com todos os descontos |
| `subtotal` | O `Valor total` riscado na tela: a soma das linhas a preço cheio |
| `economia` | `subtotal − total`. É o número em reais para a mensagem. Nunca cite percentual |
| `hostawayTotal` | Só as diárias, com taxa de hóspede adicional. Serve de conferência |
| `noites` | Noites da estadia |
| `itens` | Uma linha por item. `incluso: true` = vem no pacote; `false` = extra escolhido |
| `bonusAplicado` | Se o bônus de saída entrou (late ativo + noite seguinte livre) |
| `dataLimiteCancelamentoExtras` | Data-limite de cancelamento dos extras com reembolso |
| `disponiveis` | Extras oferecíveis nestas datas. Item com `motivoIndisponivel` aparece mas não pode ser contratado |

O valor no Pix é `total` com 3% a menos, arredondado para a dezena abaixo.

## Resposta quando as datas NÃO fecham

```json
{
  "compativel": false,
  "motivo": "A chegada deste pacote é sexta.",
  "alternativa": {
    "rotulo": "Ver a próxima data que fecha este pacote",
    "href": "/pacotes/fim-de-semana-completo?checkin=2026-09-18&checkout=2026-09-20"
  }
}
```

`motivo` é a explicação em português, pronta para repassar. `alternativa.href` é
sempre uma URL real que pode ser enviada ao cliente — nunca um rótulo.

## Quando as datas fecham mas já estão vendidas

São três respostas diferentes, e a diferença importa para o que dizer ao cliente:

| Situação | `motivo` | `alternativa` |
|---|---|---|
| Ocupado nesta casa, livre na outra | `Estas datas já estão reservadas no Solarium 1.` | Link para a **outra casa nas mesmas datas** |
| Ocupado nas duas casas | `Estas datas já estão reservadas nas duas casas.` | Link para a **próxima data livre** do mesmo pacote |
| Hostaway fora do ar | `Não conseguimos calcular o preço agora…` | `null` — não existe alternativa a oferecer |

As duas primeiras voltam com status `200`: são respostas, não erros. A terceira
volta `502`. Se `alternativa` vier `null`, não improvise data — é o caso em que o
sistema não sabe o que está livre.

## Erros

| Status | Quando | O que fazer |
|---|---|---|
| `400` | Datas ausentes ou pacote/casa desconhecidos | Conferir os campos |
| `404` | Pacotes desligados no ambiente | Avisar o Lucas |
| `429` | Limite de consultas atingido | Aguardar o `Retry-After` em segundos |
| `502` | Hostaway indisponível | Tentar de novo em instantes; se persistir, avisar |

## Limite de consultas

**60 requisições por minuto por IP.** Um cliente indeciso faz cerca de 10 numa
sessão; a agente, algumas dezenas numa conversa. Raspar a tabela de tarifas
inteira exigiria milhares, e o limite torna isso inviável.

Excedeu, volta `429` com `Retry-After` em segundos. O contador vive no Upstash
Redis. **Se o Redis estiver fora, o limite não bloqueia** — indisponibilidade de
infraestrutura não pode derrubar a cotação do site.
