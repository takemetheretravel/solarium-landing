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
  // Mapeamento de status Cielo:
  // 1  = NotFinished  (pendente)
  // 2  = PaymentConfirmed  (PAGO — produção e sandbox)
  // 3  = Denied
  // 10 = Voided
  // 11 = Refunded
  // 12 = Pending (legado — alguns gateways retornam isso em vez de 1)
  // 13 = Aborted
  // Sandbox Pix: para confirmar pagamento, use o simulador da Cielo:
  // https://developercielo.github.io/manual/cielo-ecommerce#simulação-de-pagamentos

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
      } else {
        // Pix confirmado, Hostaway falhou → marca para criação manual
        await updateDraft(draftId, { hostawayReservationId: -1 });
        console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY 🚨🚨🚨");
        console.error(
          JSON.stringify(
            {
              ACAO_NECESSARIA: "Criar reserva manualmente no Hostaway",
              propriedade: draft.propertyName,
              listingId: property.id,
              checkin: draft.checkin,
              checkout: draft.checkout,
              hospedes: draft.guests,
              nome: `${draft.guestFirstName} ${draft.guestLastName}`,
              email: draft.guestEmail,
              telefone: draft.guestPhone,
              cpf: draft.guestCpf,
              valorTotal: draft.finalTotal,
              pagamento: "Pix",
              cieloPaymentId: draft.cieloPaymentId,
              draftId,
            },
            null,
            2,
          ),
        );
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
