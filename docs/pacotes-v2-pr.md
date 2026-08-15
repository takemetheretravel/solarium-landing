# PR — Pacotes V2 (`feature/pacotes-v2` → `main`)

Conteúdo pronto para colar na descrição do PR. Aberto manualmente porque `gh` não
está instalado na máquina de trabalho.

> **Nada aqui altera o comportamento de produção.** Tudo atrás de
> `NEXT_PUBLIC_PACOTES_V2` (default `false`). Com a flag desligada o site renderiza
> exatamente como hoje — verificado no HTML gerado, não só no código.

---

## Fase 0 — resultado de cada item

**0.1 · Pessoa adicional — BLOQUEANTE, confirmado.** A Hostaway já cobra:
`guestsIncluded = 2`, `priceForExtraPerson = 100` (por pessoa, por noite) nas três
listings, e `calculatePriceDetailed` já repassa isso. O extra de R$ 200 da
especificação cobraria em dobro e com valor divergente. **Descartado**: vira item
informativo, fora do subtotal, exibindo o valor real da Hostaway. `cleaningFee = 0`
nas três.

**0.2 · Base do progressivo — BLOQUEANTE, livre.** Não existe motor progressivo
automático no avulso: são três cupons públicos (`DUASNOITES` 8%, `EXPERIENCIACOMPLETA`
12%, `COMEMORACAO` 17%). Incidem **só** sobre o total Hostaway; extras entram depois,
sem desconto. É essa diferença que sustenta a economia do pacote. **Avulso não foi
alterado.**

**0.3 · Extras hoje.** Duas famílias: serviço (`service-extras.ts`, 4 itens) e
operacionais (`operational-extras.ts`, early/late). UI em `BookingPageClient`, rota
`/reservar`, revalidação no draft, persistência no Redis, entrega via `hostNote`.
Existiam 6 dos 12 itens do catálogo.

**0.4 · Registro na Hostaway — risco confirmado.** Só `hostNote` (texto livre,
concatenado). Sem linha financeira discriminada e sem marcação automática de pago.

**0.5 · Ordem da home.** 13 seções em `page.tsx`. A §7.1 lista 10 e **omite Parceiros
e Dúvidas frequentes** — preservadas, sem alterar a posição relativa das dez nomeadas.

**0.6 · Vercel.** Cron diário em `vercel.json`, consistente com Hobby na leitura
inicial; o dono confirmou depois que o plano é **Pro**.

**0.7 · `info_datas` — inexistente no repositório.** Zero ocorrências em `src/`,
`scripts/` e `*.md`. A única fonte era `HOLIDAY_RANGES_2026`, usada com a semântica
oposta (bloquear pacotes em feriado).

**0.8 · Cancelamento vigente.** `FAQ.tsx:19`, `[propertyId]/page.tsx:256`, links para
`/termos#cancelamento`. Regra: 7 dias **após a confirmação**, com 24h mínimas antes do
check-in.

---

## Decisões e desvios em relação à especificação

**§4 · Base do desconto (alterada pelo dono, duas vezes).** O progressivo incide
sobre o total Hostaway **+ early check-in e late check-out**. Todos os demais extras
entram no subtotal a preço cheio e não recebem desconto.

**§4.2 · Bônus de saída (generalizado).** Aplica com late ativo, noite seguinte livre,
e check-out em domingo **ou** em segunda com feriado na estadia. Sem late, nunca há
bônus. O exemplo sex–seg da especificação deixa de diferir do qui–dom.

**§4.3 · Completo.** Tarifa 100% Hostaway, nenhum valor no repositório. Bônus R$ 350,
não R$ 700.

**§4.4 · Piso de 8% no Dois Casais.** Removido — a tabela progressiva já devolve 8%
em 2 noites.

**§5.1 / §12 · Late check-out incluso: R$ 550, não R$ 850.** Desvio mais relevante.
O fluxo avulso cobra tabela de semana quando a noite bloqueada cai em domingo ou
segunda, que é o caso dos três pacotes afetados. Manter 850 no pacote inflaria a
economia exibida em R$ 300 contra a regra de âncora honesta. Decisão do dono:
alinhar ao preço real. Dois Casais não mudou.

**§7.1 · Home.** As 13 seções viraram entradas nomeadas; a ordem é dado, não
estrutura. `ORDEM_ATUAL` (flag off) reproduz a de hoje; `ORDEM_V2` aplica a do
documento.

**§9 · Cancelamento de extras.** Janela de 7 dias a partir do **check-in**. Como a
política da estadia também diz "7 dias", mas ancorada na confirmação, toda superfície
escreve a **data** ("até 14 de setembro"), nunca a regra.

**§12 · Golden tests.** Os valores do documento (3.720 · 4.000 · 6.230 · 6.580)
correspondem a duas revisões anteriores. Válidos:

| Caso | base | desconto | total |
|---|---|---|---|
| FDS Completo baixa | 3.950 | 666 | 3.460 |
| FDS Completo alta | 4.250 | 690 | 3.740 |
| FDS sem café | 3.950 | 666 | 3.280 |
| Feriado qui–dom c/ bônus | 7.000 | 1.190 | 5.990 |
| Feriado sex–seg s/ bônus | 7.000 | 840 | 6.340 |

Economia FDS baixa: 3.858 − 3.460 = **R$ 398**, calculada.

---

## Riscos abertos

**1 · `info_datas` sem fonte multi-ano.** A tabela local cobre só 2026. Há teste que
falha o build quando o ano corrente passar disso, para o Feriado na Serra não ficar
cego em silêncio. **Decisão necessária antes de manter o pacote ativo além de 2026.**

**2 · Registro de extras na Hostaway depende de configuração da conta.**
`customFieldValues` só é preenchido se existirem campos com os nomes esperados
(`Pacote`, `Extras`, `Cancelamento de extras`). Sem eles, o registro cai no `hostNote`
estruturado e um aviso vai ao log. Nenhum dado se perde, mas a conciliação item a item
depende de criar os campos.

**3 · Reserva não nasce paga.** Limitação da API pública da Hostaway, pré-existente:
marcar como paga continua manual, por reserva.

**4 · Chave de debug hardcoded em repositório público.** `DEBUG_KEY = "lucas2026"` em
`api/debug/price-test` e `api/debug/regenerate-token`. Fora do escopo desta fase,
mas qualquer pessoa que leia o repo lê calendário e preços de produção e força
rotação do token Hostaway.

**5 · Filtro contextual da home não ligado.** Em `/pacotes` o seletor de datas
recalcula todos os cards contra a tarifa real. Na **home** os cards seguem mostrando
os três padrão com "a partir de": ela renderiza estaticamente com `revalidate = 300`
e ler `searchParams` ali tornaria a página inteira dinâmica, trocando o desempenho
da landing principal por um filtro que `/pacotes` já entrega. Decisão consciente.

---

## Como testar

1. Vercel → Environment Variables → **`NEXT_PUBLIC_PACOTES_V2` = `true`**, escopo
   **Preview**, branch `feature/pacotes-v2`. O nome precisa do prefixo `NEXT_PUBLIC_`:
   a flag é lida por componente cliente, e sem o prefixo o servidor liga e o cliente
   não.
2. Opcional: `RESERVA_TESTE=true` no mesmo escopo, para marcar as reservas com
   `[TESTE]`.
3. **Redeploy** — variável de ambiente só vale depois disso.
4. Roteiro de reservas de teste em `docs/reservas-teste-pacotes-v2.md`.
