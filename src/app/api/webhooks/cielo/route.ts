import { NextResponse } from "next/server";
import { getDraft, updateDraft, findDraftByBraspagPaymentId , draftIdDeOrderId } from "@/lib/kv-store";
import { getPaymentStatus } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      PaymentId?: string;
      ChangeType?: number;
      MerchantOrderId?: string;
    };
    console.log("[Webhook:Cielo]", JSON.stringify(body));

    const { PaymentId: paymentId, ChangeType: changeType, MerchantOrderId: merchantOrderId } = body;

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
          return NextResponse.json({ ok: true, provider: "braspag", method: "card", ignored: true });
        }
        // Pix já reservado = notificação tardia → sem ação.
        if (typeof braspagDraft.hostawayReservationId === "number" && braspagDraft.hostawayReservationId > 0) {
          console.log("[Webhook:Cielo] provider=BRASPAG Pix já reservado — notificação tardia; sem ação. draftId:", braspagDraft.id);
          return NextResponse.json({ ok: true, provider: "braspag", method: "pix", alreadyReserved: true });
        }
        const result = await confirmPixPaymentIfPaid(braspagDraft.id);
        console.log(
          "[Webhook:Cielo] provider=BRASPAG método=pix " +
            JSON.stringify({ draftId: braspagDraft.id, paymentId, merchantOrderId, result: result.status }),
        );
        return NextResponse.json({ ok: true, provider: "braspag", method: "pix", result: result.status });
      }
    }
    console.log("[Webhook:Cielo] provider=CIELO (nenhum draft Braspag correspondeu)");

    if (!paymentId || changeType !== 1) return NextResponse.json({ ok: true });

    const cieloStatus = await getPaymentStatus(paymentId);
    if (cieloStatus.status !== 2) return NextResponse.json({ ok: true });

    if (!merchantOrderId) {
      console.error("[Webhook:Cielo] No MerchantOrderId");
      return NextResponse.json({ ok: true });
    }

    // MerchantOrderId pode trazer sufixo de tentativa; o draft é o prefixo.
    const draftId = draftIdDeOrderId(merchantOrderId);
    const draft = await getDraft(draftId);
    if (!draft || draft.status === "paid") return NextResponse.json({ ok: true });

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

        console.log("[Webhook:Cielo] Reserva criada:", reservation.reservationId);
      } else {
        console.error("[Webhook:Cielo] FALHA ao criar reserva Hostaway para draft:", merchantOrderId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Webhook:Cielo] Exception:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
