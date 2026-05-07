import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { getPaymentStatus } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";

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

    if (!paymentId || changeType !== 1) return NextResponse.json({ ok: true });

    const cieloStatus = await getPaymentStatus(paymentId);
    if (cieloStatus.status !== 2) return NextResponse.json({ ok: true });

    if (!merchantOrderId) {
      console.error("[Webhook:Cielo] No MerchantOrderId");
      return NextResponse.json({ ok: true });
    }

    const draft = await getDraft(merchantOrderId);
    if (!draft || draft.status === "paid") return NextResponse.json({ ok: true });

    await updateDraft(merchantOrderId, { status: "paid", cieloPaymentId: paymentId });

    const property = getPropertyBySlug(draft.propertyId);
    if (property && !draft.hostawayReservationId) {
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
        source: "solarium-direct-webhook",
      });
      if (reservation) {
        await updateDraft(merchantOrderId, { hostawayReservationId: reservation.reservationId });
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
