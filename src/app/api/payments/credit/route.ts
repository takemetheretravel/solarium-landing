import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { createCreditPayment } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { draftId, cardNumber, cardHolder, cardExpiration, cardCvv, installments } =
      (await req.json()) as {
        draftId?: string;
        cardNumber?: string;
        cardHolder?: string;
        cardExpiration?: string;
        cardCvv?: string;
        installments?: number;
      };

    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
    if (!cardNumber || !cardHolder || !cardExpiration || !cardCvv) {
      return NextResponse.json({ error: "Dados do cartão incompletos" }, { status: 400 });
    }

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });

    if (draft.nights === 1) {
      return NextResponse.json(
        { approved: false, returnMessage: "Pagamento com cartão disponível apenas para estadias de 2 ou mais noites." },
        { status: 400 },
      );
    }

    const amountCents = Math.round(draft.finalTotal * 100);

    const result = await createCreditPayment({
      orderId: draftId,
      amount: amountCents,
      installments: installments || 1,
      cardNumber,
      cardHolder,
      cardExpiration,
      cardCvv,
      customerName: `${draft.guestFirstName} ${draft.guestLastName}`,
      customerCpf: draft.guestCpf,
      customerEmail: draft.guestEmail,
    });

    if (!result.approved) {
      return NextResponse.json(
        { approved: false, returnMessage: result.returnMessage || "Pagamento não aprovado. Verifique os dados do cartão." },
        { status: 402 },
      );
    }

    await updateDraft(draftId, { cieloPaymentId: result.paymentId, status: "paid" });

    const property = getPropertyBySlug(draft.propertyId);
    if (property) {
      const reservation = await createHostawayReservation({
        listingMapId: property.id,
        arrivalDate: draft.checkin,
        departureDate: draft.checkout,
        numberOfGuests: draft.guests,
        guestFirstName: draft.guestFirstName,
        guestLastName: draft.guestLastName,
        guestEmail: draft.guestEmail,
        phone: draft.guestPhone,
        totalPrice: draft.finalTotal,
        currency: "BRL",
        notes: draft.guestNotes,
        source: "solarium-direct-card",
      });
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
      }
    }

    return NextResponse.json({
      approved: true,
      paymentId: result.paymentId,
      redirectTo: `/reservar/${draftId}/confirmacao`,
    });
  } catch (err) {
    console.error("[/api/payments/credit] Exception:", err);
    const message =
      (err as Error)?.message?.startsWith("Cielo:")
        ? (err as Error).message.replace("Cielo: ", "")
        : "Erro ao processar pagamento. Tente novamente ou fale com o concierge.";
    return NextResponse.json({ approved: false, returnMessage: message, error: message }, { status: 500 });
  }
}
