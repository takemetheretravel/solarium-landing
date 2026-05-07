import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { getPaymentStatus } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const draftId = searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ status: "error" });

  const draft = await getDraft(draftId);
  console.log("[Pix:status] draftId:", draftId, "cieloPaymentId:", draft?.cieloPaymentId, "status:", draft?.status);
  if (!draft) return NextResponse.json({ status: "expired" });
  if (!draft.cieloPaymentId) return NextResponse.json({ status: "pending" });

  if (draft.status === "paid") {
    return NextResponse.json({ status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` });
  }

  const cieloStatus = await getPaymentStatus(draft.cieloPaymentId);
  console.log("[Pix:status] Cielo status:", cieloStatus.status, "for paymentId:", draft.cieloPaymentId);

  if (cieloStatus.status === 2) {
    await updateDraft(draftId, { status: "paid" });

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
        source: "solarium-direct-pix",
      });
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
      }
    }

    return NextResponse.json({ status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` });
  }

  if (cieloStatus.status === 3 || cieloStatus.status === 13) {
    await updateDraft(draftId, { status: "failed" });
    return NextResponse.json({ status: "failed" });
  }

  return NextResponse.json({ status: "pending" });
}
