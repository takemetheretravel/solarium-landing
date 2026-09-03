# Runbook — pagamentos

Como ler o que passou a ser registrado, e o que fazer quando algo chega.

Comandos em **PowerShell**. O ambiente do operador é Windows.

---

## 1. Os prefixos de log

Filtrar no painel da Vercel (Logs → campo de busca) ou no export.

| Prefixo | Nível | O que significa | Ação |
|---|---|---|---|
| `[CSP:violacao]` | warn | Uma origem foi bloqueada ou seria bloqueada. Uma linha por violação distinta. | Ler `disposition` (seção 2). |
| `[CSP:violacao:agregado]` | warn | A mesma violação se repetiu. Traz só a contagem do minuto. | Nenhuma. É enxugamento de ruído. |
| `[Telemetria]` | info | Etapa normal do fluxo no navegador. | Nenhuma. Serve para reconstruir a jornada. |
| `[Telemetria] … etapa=3ds_timeout` | **warn** | O SDK do 3DS não retornou em 120s. | Já gerou e-mail. Ver seção 5. |
| `[Telemetria] … etapa=submit_erro_rede` | **warn** | O `fetch` da cobrança rejeitou antes de haver resposta HTTP. | Já gerou e-mail. Ver seção 5. |
| `[Telemetria] … etapa=pagina_abandonada` | info | Saiu entre `3ds_iniciado` e `submit_iniciado`. | Isolado, ignore. Repetido no mesmo draft, ver seção 6. |
| `[FalhaTerminal]` | **error** | Falha terminal detectada. Um e-mail saiu, salvo se o anti-flood silenciou. | Seção 5. |
| `[FalhaTerminal] silenciada pelo anti-flood` | info | Segunda falha do mesmo draft dentro de 15 min. | Nenhuma. O primeiro e-mail já foi. |
| `[Cron:auth]` | **error** | Um cron foi recusado com 401. | Seção 4. |
| `[Hostaway:conciliacao] endpoint indeterminado` | **error** | Não foi possível localizar as cobranças da reserva. | Seção 3. |
| `[Braspag:AF-bloqueio]` | error | Antifraude reprovou uma transação já autorizada pelo emissor. | Seção 6. |

### Reconstruir a jornada de um hóspede

No painel, busque pelo `draftId`. As linhas de `[Telemetria]` saem em ordem. A
sequência saudável é:

```
3ds_iniciado → 3ds_desafio_exibido → 3ds_retorno_sucesso → submit_iniciado
```

Onde ela **para** é o diagnóstico:

| Última etapa vista | Leitura |
|---|---|
| `3ds_iniciado` | Nunca chegou a clicar em pagar. Formulário, validação, desistência. |
| `3ds_desafio_exibido` | Travou no desafio do banco. Se veio `3ds_timeout`, o SDK não respondeu. |
| `3ds_retorno_falha` | O 3DS recusou. A tela já oferece nova tentativa. |
| `3ds_retorno_sucesso` sem `submit_iniciado` | **O buraco do incidente de 02/09.** O 3DS passou e a cobrança não foi pedida. |
| `submit_iniciado` sem resposta no log do servidor | A requisição não chegou. Rede do hóspede. |

---

## 2. O campo `disposition` do CSP

É o campo mais importante da linha `[CSP:violacao]`.

| Valor | Significa | Urgência |
|---|---|---|
| `report` | A política **apenas observou**. Nada foi bloqueado, nada quebrou. | Baixa. É a lista do que quebraria se ligássemos o enforce. |
| `enforce` | A política **bloqueou de verdade**. Algo deixou de carregar. | Alta se `isPaymentRoute` for `true`. |

`disposition` ausente é normalizado para `report` — nunca para `enforce`.
Afirmar bloqueio que não houve manda a operação caçar problema inexistente.

**`disposition: enforce` + `isPaymentRoute: true` é o pior caso**: algo foi
bloqueado na tela onde o hóspede digita o cartão. Ver `effectiveDirective` e
`blockedURL` para saber o quê.

Este ciclo **não muda a CSP**. O objetivo é descobrir o que ela bloqueia.

---

## 3. `[Hostaway:conciliacao] endpoint indeterminado`

O pagamento foi capturado no gateway, a reserva existe, mas não conseguimos
localizar a lista de cobranças para marcar a que está `DUE`.

A entrada **permanece na fila** — nada foi perdido e nada foi duplicado.
Deliberado: registrar uma cobrança sem confirmar que ela já existe pode
duplicar o lançamento, e cobrança duplicada exige estorno e conversa com o
hóspede. Pendente só espera.

**Ação manual:** abra a reserva no painel da Hostaway, encontre a cobrança com
status `DUE` e marque como paga com a data da captura no gateway.

Para investigar o contrato da API (só leitura, não altera nada):

```powershell
$env:HOSTAWAY_ACCOUNT_ID = "<id>"
$env:HOSTAWAY_API_KEY = "<chave>"
node scripts/hostaway-contrato.mjs --reserva 65714576
```

A linha de log traz `chaves_da_reserva=` — é a lista de campos que a Hostaway
devolveu. Se a coleção de cobranças aparecer ali com um nome que ainda não
procuramos, acrescente-o à lista em `listarCobrancasHostaway`.

---

## 4. `[Cron:auth]` — 401 nos crons

Três booleanos separam as causas em uma execução:

| `header_presente` | `secret_configurado` | Causa | Correção |
|---|---|---|---|
| `false` | `true` | A Vercel não está mandando o header: `CRON_SECRET` não existe no projeto. | Criar `CRON_SECRET` na Vercel e **redeploy**. |
| `true` | `false` | O runtime não tem o segredo. | A variável existe mas não está no ambiente do deployment. Conferir escopo (Production/Preview). |
| `true` | `true` | Os dois existem e **divergem**. | Comparar `len_recebido` com `len_esperado`: diferença de 1 costuma ser quebra de linha colada junto do valor. |

Testar à mão:

```powershell
$env:CRON_SECRET = "<valor lido no painel>"
Invoke-WebRequest -Uri "https://<dominio>/api/hostaway/finalizar-pagamentos" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } -Method GET
```

Exercitar as duas rotas pelo smoke:

```powershell
$env:SMOKE_BASE_URL = "http://localhost:3000"
$env:CRON_SECRET = "<valor>"
npm run smoke
```

Sem essas variáveis a checagem é **pulada**, não reprovada — falta de ambiente
não pode quebrar o build.

---

## 5. Chegou o e-mail `[Solarium] Falha no pagamento — <draftId>`

Significa: **o hóspede não tem mais caminho automático nesta tentativa.** Ele
está na tela, travado, e provavelmente vai desistir.

No máximo **1 e-mail por draft a cada 15 minutos**. Seis tentativas em 18
minutos geram no máximo 2.

Passo a passo:

1. **Ler o motivo.** Ele diz o que aconteceu:
   - `3DS sem retorno em 120s` — o banco do hóspede não respondeu. Sugerir Pix.
   - `erro de rede no envio da cobrança` — conexão do hóspede. Sugerir tentar de novo.
   - `Nª recusa consecutiva do emissor` — o cartão não vai passar. Sugerir outro cartão ou Pix.
   - `excecao nao tratada na rota de cobranca` — **defeito nosso**. Ver o log pelo `draftId` e escalar.
2. **Conferir se o hóspede não concluiu sozinho.** Busque o `draftId` no log: se
   houver `📧 NOVA RESERVA PAGA` depois, ele conseguiu. Não faça contato.
3. **Se não concluiu**, entre em contato pelo WhatsApp do e-mail. O draft vive
   24h — ele consegue retomar o mesmo link.
4. **Nunca peça dados de cartão por mensagem.** Mande o link do checkout.

---

## 6. `[Braspag:AF-bloqueio]` repetido no mesmo draft

O emissor **autorizou** e o antifraude reprovou. O dinheiro não foi capturado
(há void logo em seguida), então não há o que estornar.

Reason code 481 com score baixo indica regra fixa de perfil, do lado da Braspag.
Isso é chamado com eles, **não é código**.

Enquanto o fallback automático (PR seguinte) não estiver em produção, a ação é
orientar o hóspede a pagar por Pix ou aguardar contato.

---

## 7. Rollback

Os dois PRs são independentes e revertem em separado.

### PR 1 — observabilidade e conciliação

Puramente aditivo: só acrescenta log, telemetria e um caminho alternativo de
leitura na Hostaway. **Reverter não restaura comportamento nenhum de pagamento**
— só volta a cegueira.

```powershell
git revert --no-edit -m 1 <sha-do-merge-do-PR-1>
git push origin main
```

Reverter apenas a telemetria do cliente (se algo na tela de pagamento regredir),
sem perder o resto:

```powershell
git checkout main -- "src/app/(checkout)/reservar/[draftId]/pagamento/page.tsx"
git commit -m "revert: telemetria no cliente da rota de pagamento"
git push origin main
```

### PR 2 — fallback automático Braspag → Cielo

Este **muda comportamento de pagamento**. Reverter volta ao estado em que o
hóspede é deixado sozinho após o bloqueio do antifraude.

```powershell
git revert --no-edit -m 1 <sha-do-merge-do-PR-2>
git push origin main
```

Desligar sem deploy não é possível por variável neste ciclo — o fallback é
decidido em código. Se precisar de corte imediato, reverta.

Depois de qualquer revert, **confirme que o deployment de produção foi criado**:
cron sub-diário exige plano Pro, e no Hobby a Vercel rejeita o deployment em
silêncio (ver `DECISOES.md`).

---

## 8. Verificação após deploy

```powershell
npm run smoke
npm run build
```

Em produção, confirmar que as linhas novas aparecem:

1. Abrir a tela de pagamento de um draft de teste → procurar `[Telemetria] … etapa=3ds_iniciado`.
2. Procurar `[CSP:violacao]` — se não houver nenhuma em 24h, ou a política está
   limpa ou o coletor não está recebendo. Conferir se `/api/csp-report` responde
   204.
3. Rodar um cron à mão (seção 4) e confirmar 200.
