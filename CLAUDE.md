# CLAUDE.md — Solarium Mantiqueira (solarium-landing)

Contexto permanente do projeto. Leia antes de qualquer alteração.
Este arquivo existe para você **não precisar perguntar** o que já está aqui.

---

## 1. Projeto

Site de reserva direta do Solarium Mantiqueira: duas casas de temporada em
Itanhandu, MG (Solarium 1, Solarium 2) mais a locação conjunta (Solarium
Completo). Reserva, pagamento e gestão acontecem no próprio site.

Next.js 14 (App Router) · TypeScript · Tailwind · deploy na Vercel.

**Repositório público.** Nada de segredo, chave, token ou dado de hóspede
em código, comentário, teste ou fixture.

**Hostaway** (PMS): conta `123192` · listings Sol1 `316007`,
Sol2 `316005`, Completo `316006`.

## 2. Regras de ouro (nunca violar)

1. **Nunca quebrar a produção.**
2. **O pagamento em produção HOJE é Cielo E-commerce 3.0** (cartão + Pix).
   Não alterar `cielo.ts` nem o fluxo Cielo sem instrução explícita.
3. **Não alterar nada sob `/reservar/[draftId]/pagamento`** sem instrução
   explícita na rodada. Inclui layout groups, CSP e 3DS. O GTM é excluído
   dessa rota **estruturalmente**, via grupo de layout — não é acidente,
   não "conserte".
4. **Recálculo de preço SEMPRE server-side.** Âncora honesta, sem inflar
   valor.
5. **Credenciais só em env vars** (`.env.local` / Vercel). Nunca hardcode.
6. **Purchase é exclusivamente server-side** (GA4 Measurement Protocol +
   Meta CAPI). Nunca dispare purchase no browser. Idempotência via KV
   `webhook_events`, chaveada em `payment_id + change_type`.
7. **Não alterar os valores dourados de pacote** nos testes:
   R$ 3.460 / R$ 3.740 / R$ 5.990 / R$ 6.340. Se um quebrar, o bug é seu.
8. Extras de serviço aparecem **sem o símbolo "R$"** nos itens de linha;
   total e botão de pagar com "R$" completo.
9. **Cupom não combina com pacote.**
10. Testar em branch de preview antes do merge. Nunca commitar direto na
    `main` sem pedir. Nunca `git push --force`, `git rebase` em branch
    compartilhada ou `git reset --hard`.
11. **Não criar rota de debug ou admin sem autenticação real.** O
    repositório é público; chave em querystring não é proteção.
12. Nada de `localStorage`/`sessionStorage` para estado de reserva.

## 3. Migração Braspag (em andamento)

- Gateway novo na plataforma Braspag (`api.braspag.com.br`), em paralelo à
  Cielo, atrás da feature flag `PAYMENT_PROVIDER` (default `"cielo"`).
  Inclui 3DS 2.0 + Antifraude Cybersource.
- Branch de trabalho: `feature/braspag-gateway`.
- MerchantId: `D01A28D5-EA80-4C4D-A042-BA1E6FF4FA72`. MCC: `7011`.
- Camadas: (0) scaffold de conectividade [pronto] · (1) 3DS ·
  (2) Antifraude Cybersource · (3) Pix.
- **Decisão fechada: captura SEPARADA no fluxo real**
  (autoriza → antifraude → `PUT /v2/sales/{PaymentId}/capture`).
  Não usar `Capture:true` em produção — só no smoke test de conectividade.
- Env vars: `BRASPAG_ENVIRONMENT`, `BRASPAG_MERCHANT_ID`,
  `BRASPAG_MERCHANT_KEY`, `BRASPAG_3DS_CLIENT_ID`,
  `BRASPAG_3DS_CLIENT_SECRET`, `PAYMENT_PROVIDER`. Valores nunca aqui.

### Antifraude Cybersource — Revisão Manual 4h (a implementar)

Confirmado com a Braspag/Cielo em set/2026:

- `FraudAnalysis.Status` retorna `Accept`, `Review` ou `Reject`.
- **Review**: transação permanece **autorizada e não capturada**. Nenhuma
  captura, nenhuma criação de reserva no Hostaway, nenhum purchase
  disparado, até decisão final.
- A decisão final chega por **notificação automática** do gateway. Não
  depende de polling.
- **Reject**: o cancelamento da autorização é **automático** do lado do
  gateway junto à adquirente. Não enviar cancelamento.
- **Não existe forma de forçar uma transação a cair em Review.** O caminho
  Review só pode ser validado com payload sintético contra o próprio
  webhook; o que é testável de verdade é o par autorizar-sem-capturar +
  capturar depois.
- A abrir com a Braspag: qual `ChangeType` carrega a decisão do antifraude,
  e se a URL de notificação desse tipo exige cadastro próprio no backoffice.

## 4. Vocabulário de marca (todo texto visível ao hóspede)

**Proibido:** luxo · exclusivo · premium · sofisticado · investimento (para
diárias) · experiência única · momentos inesquecíveis · o lugar perfeito ·
chalé · pousada · amenidades · unidade

É sempre **casa**. Nunca chalé, nunca pousada. Linguagem de casa e
curadoria, nunca de hotel.

Assinatura verbal: *"Não é só ficar. É pertencer."*

Logo: mínimo 120px de largura no digital. Nunca alterar cor, girar,
deformar ou aplicar sombra.

## 5. Cloudinary

Cloud name `dmfoddfz3`. O Cloudinary serve o site — **não é o arquivo
morto**. Os originais em alta vivem no Drive.

```
solarium/casas/{casa}/{ambiente}/{NN}-{slug}
solarium/casas/{casa}/hero
```

`casa` ∈ `solarium-1 | solarium-2 | solarium-completo`
`ambiente` ∈ `vista | spa | cinema | quarto | cozinha | sala | externa |
amanhecer | conjunto`

O **alt text mora em `context.alt`** do asset, não no código. Estação
(`verde` / `seca`), `pessoas` e `destaque` são **tags**. O manifesto em
`content/galerias/*.json` é **gerado**, nunca editado à mão.

Presets nomeados em `lib/cloudinary.ts`, nunca transformação inline:
- `HERO` — `c_fill,ar_4:3,f_auto,q_auto`
- `MOSAICO` / `MINIATURA` — `c_fill,f_auto,q_auto` com `sizes` real
- `LIGHTBOX` — `c_limit` (preserva enquadramento, nunca corta)

Credenciais locais: `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` precisam
ser preenchidos à mão em `.env.local`. `vercel env pull` grava
`[SENSITIVE]` e os scripts falham em silêncio.

## 6. Arquivos-chave

- `src/config/` — coupons, properties, packages, service-extras,
  operational-extras, payment-provider
- `src/lib/` — cielo, braspag, cloudinary, hostaway
  (`createHostawayReservation`, `blockCalendarNight`,
  `calculatePriceDetailed`), kv-store, email, cn
- `src/app/api/` — payments/credit, payments/pix, payments/braspag/test,
  reservations/draft, availability/check, extras/check, webhooks/cielo,
  webhooks/braspag
- `content/galerias/` — manifestos de galeria (gerados)
- `scripts/` — gerar-manifesto, upload-casas-cloudinary, curadoria-casas

## 7. Comandos

```bash
npm run dev
npm test                 # suíte completa — antes de qualquer PR
npm run build            # precisa passar limpo
npx tsc --noEmit         # precisa passar limpo
npm run galeria:sync     # regenera manifesto a partir do Cloudinary
npm run upload:casas     # sobe fotos locais para o Cloudinary
```

## 8. Avisos operacionais

**Cron na Vercel.** O plano Hobby só aceita cron **diário**. Um cron mais
frequente (ex.: `*/10 * * * *`) em `vercel.json` faz a Vercel **rejeitar o
deployment silenciosamente** na validação — o deploy não é criado e **não
aparece nem como erro** na lista. Sintoma: commits param de publicar sem
explicação. O cron do `pix-reconcile` está em `0 6 * * *`.

> A conta já migrou para o plano Pro. E não tem esse problema.


## 9. Estilo de trabalho

- Decisões diretas, flags de risco proativas, sem floreio. Prompts em
  português.
- O trabalho anda em **rodadas nomeadas** com escopo fechado.
  Uma rodada = **um entregável**. Passando de ~8 arquivos, pare e proponha
  dividir **antes** de escrever código.
- Instrução padrão: **"NÃO PERGUNTE — DECIDA E SIGA."** Havendo tradeoff
  sem resposta óbvia, escolha, siga, e registre escolha e motivo em
  `DECISOES.md`.
- **Não expanda escopo.** Achado fora do escopo vai para `DECISOES.md` sob
  "Achados fora de escopo", sem correção.
- Todo PR descreve: o que mudou, decisões tomadas, e o que **não** foi
  feito de propósito.
- Teste existente que quebra significa código errado. Só altere o teste com
  justificativa escrita no PR.

## 10. Estado conhecido (atualizar quando mudar)

- Conciliação Hostaway retornando 401 em todas as execuções — **aberto**
- CSP em report-only, ainda não aplicada — **aberto**
- Rotas de debug protegidas só por chave em querystring — **aberto**
- `feat/galeria-cloudinary` aberta, com rodada 1b de correções pendente
  (lightbox sem portal, deep-link resolvendo foto errada, recorte 4:3
  vazando para o lightbox)
- Antifraude Cybersource: status `Review` ainda **não tratado**
- **CONFIRMAR:** de qual branch a produção publica. Há indício de que
  esteja servindo `feature/pacotes-v2` em vez de `main`.


