# Reservas de teste — Pacotes V2

Braspag e Hostaway rodam em **produção** no preview: sandbox não valida Pix nem 3DS de ponta a
ponta. Toda reserva criada aqui é real, com dinheiro real, e **precisa ser estornada**.

Regras:

- Usar datas de baixa demanda.
- `RESERVA_TESTE=true` no preview: a reserva nasce com o hóspede prefixado por `[TESTE]`, o
  alerta interno vem marcado e o authlog registra a marcação.
- Registrar **toda** reserva criada nesta tabela, no ato.
- Estornar pela Braspag e cancelar na Hostaway assim que o teste terminar.

---

## Registro

| Data | Pacote | Casa | Check-in → Check-out | Valor | PaymentId | Reserva Hostaway | Estornado | Cancelado na Hostaway |
|---|---|---|---|---|---|---|---|---|
| _(vazio — nenhum teste executado ainda)_ | | | | | | | | |

---

## Checklist por pacote

Um teste completo por pacote, com extras selecionados:

- [ ] Fim de Semana Completo — sexta a domingo, com cesta, mais um extra fora da base
- [ ] Fim de Semana Completo — café removido, confirmar que o bônus permanece
- [ ] Dois Casais, Uma Vista — late check-out removido, confirmar que o bônus sai junto
- [ ] Feriado na Serra — qui–dom, confirmar bônus com noite seguinte livre
- [ ] Feriado na Serra — sex–seg com feriado, confirmar bônus na segunda
- [ ] Qualquer pacote com Pix, confirmar que o valor cobrado bate com o exibido ao centavo
- [ ] Qualquer pacote com cupom enviado à força, confirmar rejeição server-side

## O que conferir em cada teste

1. Valor exibido na página do pacote **igual** ao valor cobrado na Braspag.
2. Reserva criada na Hostaway com o prefixo `[TESTE]`.
3. `hostNote` com o bloco `EXTRAS A PROVIDENCIAR` e a data-limite de cancelamento.
4. `customFieldValues` preenchido — ou o aviso no log de que a conta não tem os campos e o
   registro caiu no `hostNote`.
5. E-mail interno com o bloco `EXTRAS A PROVIDENCIAR` e a marcação de teste.
6. Noite adjacente bloqueada quando houver early ou late.
