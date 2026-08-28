import { NextResponse } from "next/server";
import { getDraft, updateDraft, enfileirarFinalizacaoHostaway } from "@/lib/kv-store";
import { enviarConversaoReserva, itensDaReserva } from "@/lib/analytics/server-conversions";
import { getPaymentStatus } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";

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
        totalPrice: draft.finalTotal, // Pix: valor com desconto, sem juros
        subtotalOriginal: draft.subtotal ?? draft.totalPrice,
        discountAmount: totalDiscount,
        couponCode: draft.couponCode,
        installments: 1,
        paymentMethod: "pix",
        currency: "BRL",
        guestNotes: draft.guestNotes || "",
        source: "solarium-direct",
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

        console.log("📧 NOVA RESERVA PAGA:", {
          hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
          propriedade: draft.propertyName,
          checkin: draft.checkin,
          checkout: draft.checkout,
          valorCobrado: `R$ ${draft.finalTotal.toFixed(2)}`,
          metodo: "Pix",
          hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
          cieloId: draft.cieloPaymentId,
        });

        // Pix confirmado pelo polling: quarto caminho que cria reserva. Ficava
        // sem conversao e sem marcacao de pagamento — o smoke apontou.
        await enfileirarFinalizacaoHostaway({
          reservation_id: reservation.reservationId,
          payment_method: "bank_transfer",
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
