## O que muda

**Este PR muda comportamento de pagamento.** Vai separado do PR de observabilidade de propósito: o Bloco 1 é aditivo e serve como janela de observação antes desta mudança.

Base: `fix/observabilidade-e-conciliacao` — o contador de bloqueios de antifraude vem de lá.

## O problema

Quando o antifraude reprova, o hóspede é deixado sozinho na tela para tentar de novo. Nos dois incidentes reais ele tentou **6 e 8 vezes**; no primeiro, só concluiu migrando **à mão** para a Cielo, 44 minutos depois de começar. Todas as seis com o emissor tendo **autorizado** (reason 481, scores de 28 a 91).

## A regra

- **Primeira tentativa: nada muda.** A Braspag continua primária; um bloqueio isolado pode ser transitório.
- **Segundo `AF-bloqueio` no mesmo draft:** o padrão está estabelecido. O draft ganha `provider_forcado = "cielo"`.
- A troca vale **só para aquele draft**. Nenhuma configuração global.

`/api/payments/provider?draftId=<id>` passa a respeitar o `provider_forcado` acima da flag — é a única coisa que a sobrepõe. Sem `draftId` ou com draft ilegível, cai na flag.

A 402 da segunda tentativa carrega `fallbackDisponivel: true`; o front reconsulta o provider e remonta a tela na Cielo com os dados já digitados. O hóspede só reenvia.

## Fail-safe conservador

`registrarBloqueioAntifraude` devolve `0` quando o Redis falha, e `0` não dispara nada. Sem contador confiável, **não troca**: mandar o hóspede para a Cielo por engano é pior que deixá-lo tentar de novo. Idem se a gravação do draft falhar.

É o oposto do fail-open da notificação, e de propósito: notificar demais custa um e-mail, trocar de gateway indevidamente custa uma transação.

## O que NÃO muda

A rota Cielo já revalida preço e disponibilidade antes de cobrar, já usa o número da reserva Hostaway como `transaction_id` (GA4) e `event_id` (Meta CAPI), e já dispara conversão **exclusivamente server-side**. O fallback só redireciona: nenhuma instrumentação duplicada, nada movido para o cliente.

Lógica de precificação e golden intactos.

## Arquivos tocados

| Arquivo | |
|---|---|
| `src/lib/fallback-gateway.ts` | novo — a regra de decisão |
| `src/lib/kv-store.ts` | + campo `provider_forcado` no draft |
| `src/app/api/payments/provider/route.ts` | respeita `provider_forcado` por `?draftId=` |
| `src/app/api/payments/braspag/credit/route.ts` | aciona o fallback no AF-bloqueio; `fallbackDisponivel` na 402 |
| `src/app/(checkout)/.../pagamento/page.tsx` | reconsulta o provider e remonta na Cielo |
| `DECISOES.md` | a regra e o fail-safe |

## Risco

**Médio — é o PR que muda o fluxo.**

O ponto de atenção é a página de pagamento: o efeito do provider ganhou `trocouParaCielo` como dependência e o `setProvider` virou explícito nos dois sentidos (antes só subia para `braspag`, então uma resposta `cielo` não descia). Sem isso o fallback não teria efeito visível.

**Não toca** o fluxo 3DS, a CSP, o isolamento de scripts nem a navegação para `/reservar/[id]/pagamento`. O 3DS não é testável fora de produção — a validação real deste PR acontece lá.

## Verificação

- `npx vitest run` — 245 testes ✅ (15 novos: contador AF e virada no segundo bloqueio; anti-flood de 15 min)
- `npm run smoke` — 17 checagens ✅ (golden 3.460 / 3.740 / 5.990 / 6.340)
- `npm run build` ✅

## Rollback

`docs/runbook-pagamentos.md` seção 7. Reverter volta ao estado em que o hóspede é deixado sozinho após o bloqueio. Não há desligamento por variável — se precisar de corte imediato, reverta.

## Merge

Só depois do PR 1 estar em produção e as linhas de `[Braspag:AF-bloqueio]` confirmarem a frequência real dos bloqueios.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
