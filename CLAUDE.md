# CLAUDE.md

## Projeto
Solarium Mantiqueira — site de reservas diretas (temporada premium, Itanhandu/MG). Next.js 14, TypeScript, Tailwind, deploy na Vercel. PMS: Hostaway (conta 123192; listings Sol1=316007, Sol2=316005, Completo=316006).

## Regras de ouro (nunca violar)
- Nunca quebrar a produção. Pagamento em produção HOJE = Cielo E-commerce 3.0 (cartão + Pix). Não alterar `cielo.ts` nem o fluxo Cielo sem instrução explícita.
- Recálculo de preço SEMPRE server-side. Âncora honesta (sem inflar valor).
- Credenciais só em env vars (`.env.local` / Vercel). Nunca hardcode — o repo é público.
- Extras de serviço exibidos sem o símbolo "R$" nos itens de linha; total e botão de pagar com "R$" completo.
- Cupom não combina com pacote.
- Testar em branch de preview antes de merge. Nunca commitar direto na `main` sem pedir.

## Migração Braspag (em andamento)
- Gateway novo na plataforma Braspag (`api.braspag.com.br`), em paralelo à Cielo, atrás da feature flag `PAYMENT_PROVIDER` (default `"cielo"`). Inclui 3DS 2.0 + Antifraude Cybersource.
- Branch de trabalho: `feature/braspag-gateway`.
- Arquitetura em camadas: (0) scaffold conectividade [pronto], (1) 3DS, (2) Antifraude Cybersource, (3) Pix.
- Decisão fechada: captura SEPARADA no fluxo real (autoriza → antifraude → `PUT /v2/sales/{PaymentId}/capture`). Não usar `Capture:true` no fluxo de produção (só no smoke test de conectividade).
- MCC do ramo: 7011 (hospedagem).
- Env vars Braspag: `BRASPAG_ENVIRONMENT`, `BRASPAG_MERCHANT_ID`, `BRASPAG_MERCHANT_KEY`, `BRASPAG_3DS_CLIENT_ID`, `BRASPAG_3DS_CLIENT_SECRET`, `PAYMENT_PROVIDER`. Valores nunca neste arquivo.

## Arquivos-chave
- `src/config/`: coupons, properties, packages, service-extras, operational-extras, payment-provider
- `src/lib/`: cielo, braspag, hostaway (`createHostawayReservation`, `blockCalendarNight`, `calculatePriceDetailed`), kv-store, email, cn
- `src/app/api/`: payments/credit, payments/pix, payments/braspag/test, reservations/draft, availability/check, extras/check, webhooks/cielo, webhooks/braspag

## Avisos operacionais (deploy)
- **Plano atual: Pro** — cron sub-diário é permitido. `finalizar-pagamentos` está em `*/5 * * * *`; `pix-reconcile` segue em `0 6 * * *`.
- **Se a conta voltar para Hobby, todo cron tem que virar DIÁRIO.** No Hobby, um cron mais frequente (ex.: `*/10 * * * *`) em `vercel.json` faz a Vercel **REJEITAR o deployment silenciosamente** na validação — o deploy não é criado e **não aparece nem como erro** na lista. Sintoma: commits param de publicar sem explicação.
- **Variável marcada como Sensitive na Vercel não volta por `vercel env pull`** — o comando grava `[SENSITIVE]` no lugar do valor. Para conferir credencial, ler o valor no painel e exportar no ambiente. Ver `DECISOES.md`.

## Estilo de trabalho
Decisões diretas, flags de risco proativas, sem floreio. Prompts em português.
