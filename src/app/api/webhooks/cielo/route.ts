import { NextResponse } from "next/server";
import {
  getDraft,
  updateDraft,
  findDraftByBraspagPaymentId,
  draftIdDeOrderId,
  insertWebhookEvent,
  markWebhookEventProcessed,
  deleteWebhookEvent,
  getPaymentIndex,
  savePaymentIndex,
  attachReservationToPaymentIndex,
  pushReconciliationPending,
  enfileirarFinalizacaoHostaway,
} from "@/lib/kv-store";
import { getPaymentStatus } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";
import { enviarConversaoReserva, itensDaReserva } from "@/lib/analytics/server-conversions";
import { redact } from "@/lib/log/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let eventoParaLiberar: { paymentId: string; changeType: string | number } | null = null;
  try {
    const body = (await req.json()) as {
      PaymentId?: string;
      ChangeType?: number;
      MerchantOrderId?: string;
    };
    console.log("[Webhook:Cielo]", JSON.stringify(redact(body)));

    const { PaymentId: paymentId, ChangeType: changeType } = body;
    let merchantOrderId = body.MerchantOrderId;

    // =========================================================================
    // IDEMPOTÊNCIA (chave única payment_id + change_type).
    //
    // Em produção o mesmo PaymentId chegou duas vezes com 109 minutos entre as
    // entregas, e as duas foram processadas. A inserção é a PRIMEIRA coisa do
    // handler: se a chave já existe, saímos sem executar nenhum efeito colateral.
    // A janela de dedup é de 30 dias — reentrega tardia continua sendo duplicata.
    // =========================================================================
    if (paymentId) {
      const { inserted } = await insertWebhookEvent({
        paymentId,
        changeType: changeType ?? "none",
        source: "cielo",
      });
      if (!inserted) {
        console.log("[Webhook:Cielo] duplicate ignored", paymentId);
        return NextResponse.json({ ok: true, duplicate: true });
      }
      // A partir daqui há efeito colateral possível: em exceção, o registro é
      // apagado para que a reentrega do gateway reprocesse o evento.
      eventoParaLiberar = { paymentId, changeType: changeType ?? "none" };
    }

    // Fecha o evento (grava processed_at) e responde. Todo caminho de saída
    // bem-sucedido passa por aqui: received_at e processed_at ficam separados,
    // e o registro deixa de ser candidato a liberação no catch.
    const finalizar = async (payload: Record<string, unknown>) => {
      if (paymentId) await markWebhookEventProcessed(paymentId, changeType ?? "none");
      eventoParaLiberar = null;
      return NextResponse.json(payload);
    };

    // =========================================================================
    // RAMIFICAÇÃO BRASPAG (ISOLADA) — a URL cadastrada no portal de PRODUÇÃO da
    // Braspag é este endpoint (/webhooks/cielo). Se a notificação corresponder a
    // um Pix Braspag (PaymentId OU MerchantOrderId == braspagPaymentId de um
    // draft), delega para a confirmação central Braspag (reconsulta + idempotente)
    // e RETORNA — o fluxo Cielo abaixo NÃO é tocado. Uma notificação Cielo real
    // não casa aqui (drafts Cielo não têm braspagPaymentId), então cai direto no
    // fluxo Cielo original.
    // =========================================================================
    if (changeType === 1 && (paymentId || merchantOrderId)) {
      const braspagDraft =
        (await findDraftByBraspagPaymentId(paymentId || "")) ||
        (await findDraftByBraspagPaymentId(merchantOrderId || ""));
      if (braspagDraft) {
        // CARTÃO Braspag é resolvido sincronamente no /credit — só loga e retorna
        // (não passa pela confirmação de Pix, para não gerar órfão falso).
        if (braspagDraft.paymentMethod === "card") {
          console.log("[Webhook:Cielo] provider=BRASPAG método=card — resolvido sincronamente; sem ação. draftId:", braspagDraft.id);
          return finalizar({ ok: true, provider: "braspag", method: "card", ignored: true });
        }
        // Pix já reservado = notificação tardia → sem ação.
        if (typeof braspagDraft.hostawayReservationId === "number" && braspagDraft.hostawayReservationId > 0) {
          console.log("[Webhook:Cielo] provider=BRASPAG Pix já reservado — notificação tardia; sem ação. draftId:", braspagDraft.id);
          return finalizar({ ok: true, provider: "braspag", method: "pix", alreadyReserved: true });
        }
        const result = await confirmPixPaymentIfPaid(braspagDraft.id);
        console.log(
          "[Webhook:Cielo] provider=BRASPAG método=pix " +
            JSON.stringify({ draftId: braspagDraft.id, paymentId, merchantOrderId, result: result.status }),
        );
        return finalizar({ ok: true, provider: "braspag", method: "pix", result: result.status });
      }
    }
    console.log("[Webhook:Cielo] provider=CIELO (nenhum draft Braspag correspondeu)");

    if (!paymentId || changeType !== 1) return finalizar({ ok: true });

    const cieloStatus = await getPaymentStatus(paymentId);
    if (cieloStatus.status !== 2) return finalizar({ ok: true });

    // =========================================================================
    // CORRELAÇÃO payment_id → merchant_order_id → draft.
    //
    // O POST de notificação da Cielo carrega apenas PaymentId e ChangeType — o
    // MerchantOrderId NÃO faz parte do corpo. Era essa a causa do log
    // "No MerchantOrderId": o handler lia um campo que o gateway nunca envia.
    // A resolução tem três degraus, do mais barato ao mais caro:
    //   1) índice local gravado na autorização (não depende de rede);
    //   2) MerchantOrderId da consulta de detalhe (getPaymentStatus já a faz,
    //      com timeout de 8s e 2 tentativas);
    //   3) corpo do webhook, se algum dia passar a trazê-lo.
    // =========================================================================
    const indice = await getPaymentIndex(paymentId);
    const origemCorrelacao = indice
      ? "payment_index"
      : cieloStatus.merchantOrderId
        ? "consulta-detalhe"
        : merchantOrderId
          ? "payload"
          : "nenhuma";
    merchantOrderId = indice?.merchant_order_id || cieloStatus.merchantOrderId || merchantOrderId;

    if (!merchantOrderId) {
      // Nenhum caminho resolveu. 200 para não gerar reentrega infinita, mas o
      // evento vira pendência explícita — nunca some em silêncio.
      console.error(
        "[Webhook:Cielo] correlação falhou " +
          JSON.stringify({ payment_id: paymentId, change_type: changeType }),
      );
      await pushReconciliationPending({
        payment_id: paymentId,
        change_type: String(changeType ?? "none"),
        source: "cielo",
        reason: "merchant_order_id não resolvido (índice local, consulta de detalhe e payload vazios)",
      });
      return finalizar({ ok: true, pendingReconciliation: true });
    }

    // MerchantOrderId pode trazer sufixo de tentativa; o draft é o prefixo.
    const draftId = indice?.draft_id || draftIdDeOrderId(merchantOrderId);
    console.log(
      "[Webhook:Cielo] correlação ok " +
        JSON.stringify({ payment_id: paymentId, merchant_order_id: merchantOrderId, draft_id: draftId, via: origemCorrelacao }),
    );

    const draft = await getDraft(draftId);
    if (!draft) {
      console.error(
        "[Webhook:Cielo] draft não encontrado " +
          JSON.stringify({ payment_id: paymentId, draft_id: draftId }),
      );
      await pushReconciliationPending({
        payment_id: paymentId,
        change_type: String(changeType ?? "none"),
        source: "cielo",
        reason: `draft ${draftId} não encontrado (expirado?) para merchant_order_id ${merchantOrderId}`,
      });
      return finalizar({ ok: true, pendingReconciliation: true });
    }
    if (draft.status === "paid") return finalizar({ ok: true, alreadyPaid: true });

    // Índice preenchido aqui quando a autorização não o gravou (fluxo Cielo
    // legado). A próxima notificação do mesmo pagamento já resolve localmente.
    if (!indice) {
      await savePaymentIndex({
        payment_id: paymentId,
        merchant_order_id: merchantOrderId,
        draft_id: draftId,
        provider: "cielo",
        method: draft.paymentMethod === "pix" ? "pix" : "card",
      });
    }

    await updateDraft(draftId, { status: "paid", cieloPaymentId: paymentId });

    const property = getPropertyBySlug(draft.propertyId);
    if (property && !draft.hostawayReservationId) {
      const totalDiscount = (draft.couponDiscount || 0) + (draft.pixDiscount || 0);
        // Bloquear ANTES de criar: o check-in do listing e as 15h e o hospede fica
        // ate as 18h. Sem o bloqueio, da para aceitar reserva nova com ele na casa.
        const bloqueio = await blockOpExtraNights(draft.propertyId, draft);
      const reservation = bloqueio.todasBloqueadas ? await createHostawayReservation({
        listingMapId: property.id,
        arrivalDate: draft.checkin,
        departureDate: draft.checkout,
        numberOfGuests: draft.guests,
        guestFirstName: draft.guestFirstName,
        guestLastName: draft.guestLastName,
        guestEmail: draft.guestEmail,
        phone: draft.guestPhone,
        totalPrice: draft.finalTotal, // webhook: assume valor sem juros (fluxo Pix)
        subtotalOriginal: draft.subtotal ?? draft.totalPrice,
        discountAmount: totalDiscount,
        couponCode: draft.couponCode,
        installments: 1,
        paymentMethod: draft.paymentMethod === "pix" ? "pix" : "card",
        currency: "BRL",
        guestNotes: draft.guestNotes || "",
        source: "solarium-direct-webhook",
        packageName: draft.packageName,
        extrasList: draft.extrasList,
        shortNotice: draft.shortNotice,
        serviceExtras: enrichServiceExtras(draft.serviceExtras),
        opExtras: draft.opExtras,
        ...paramsDePacote(draft),
      }) : null;
      if (!bloqueio.todasBloqueadas) {
        console.error("[Reserva] BLOQUEIO DE NOITE FALHOU — reserva nao criada");
      }
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
        await attachReservationToPaymentIndex(paymentId, reservation.reservationId);

        console.log("[Webhook:Cielo] Reserva criada:", reservation.reservationId);

        // Conversão server-side. Chega DEPOIS da reserva existir, porque o
        // identificador canônico é o número da reserva. Roda uma vez por
        // PaymentId: a guarda de idempotência do topo do handler já garantiu
        // que este trecho não executa de novo para a mesma notificação.
        await enfileirarFinalizacaoHostaway({
          reservation_id: reservation.reservationId,
          payment_method: draft.paymentMethod === "pix" ? "bank_transfer" : "credit_card_offline",
          amount: draft.finalTotal,
          currency: "BRL",
          draft_id: draftId,
        });
        await enviarConversaoReserva({
          reservationId: reservation.reservationId,
          value: draft.finalTotal,
          items: itensDaReserva(draft),
          provider: "cielo",
          gaClientId: draft.gaClientId,
          gaSessionId: draft.gaSessionId,
          fbp: draft.fbp,
          fbc: draft.fbc,
          email: draft.guestEmail,
          phone: draft.guestPhone,
        });
      } else {
        console.error("[Webhook:Cielo] FALHA ao criar reserva Hostaway para draft:", merchantOrderId);
        await pushReconciliationPending({
          payment_id: paymentId,
          change_type: String(changeType ?? "none"),
          source: "cielo",
          reason: `pagamento confirmado mas createHostawayReservation falhou (draft ${draftId})`,
        });
      }
    }

    return finalizar({ ok: true });
  } catch (err) {
    console.error("[Webhook:Cielo] Exception:", err);
    // Libera o registro do evento para que a reentrega do gateway reprocesse.
    if (eventoParaLiberar) {
      await deleteWebhookEvent(eventoParaLiberar.paymentId, eventoParaLiberar.changeType);
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
