import { getDraft, updateDraft, type ReservationDraft } from "@/lib/kv-store";
import { consultBraspagPayment } from "@/lib/braspag";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { enviarAlertaAprovacao } from "@/lib/email";

// =============================================================================
// Confirmação de Pix Braspag — helper ÚNICO usado por 3 entradas:
//   (1) polling da página (/api/payments/braspag/pix/status),
//   (2) webhook (/api/webhooks/braspag),
//   (3) reconciliação (/api/payments/braspag/pix-reconcile).
// Concentrar aqui garante idempotência e comportamento idêntico entre as vias.
//
// NUNCA confia em payload externo: sempre RECONSULTA o pagamento na Braspag
// (consultBraspagPayment) e só confirma se Payment.Status === 2.
//
// IDEMPOTÊNCIA: se o draft já está "paid" E já tem hostawayReservationId, é
// no-op (retorna paid sem efeitos). O updateDraft(status:"paid") acontece ANTES
// de criar a reserva, estreitando a janela de corrida entre webhook e polling
// simultâneos; o check de hostawayReservationId logo antes da criação cobre o
// restante do risco (aceitável para o volume do negócio).
//
// VALIDAR EM PRODUÇÃO: em sandbox o Pix nunca muda de status (sem pagamento
// real), então este caminho só é exercitável de verdade em produção.
// =============================================================================

export type PixConfirmResult =
  | { status: "paid"; redirectTo: string }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "expired" };

export async function confirmBraspagPixIfPaid(draftId: string): Promise<PixConfirmResult> {
  const draft = await getDraft(draftId);
  if (!draft) return { status: "expired" };

  // Idempotência: já pago e com reserva criada (ou marcada p/ criação manual).
  if (draft.status === "paid" && draft.hostawayReservationId !== undefined) {
    return { status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` };
  }
  if (!draft.braspagPaymentId) return { status: "pending" };

  // Reconsulta server-side — única fonte de verdade do status.
  const consult = await consultBraspagPayment(draft.braspagPaymentId);
  console.log(
    "[BraspagPix:confirm] draft=%s paymentId=%s status=%s",
    draftId,
    draft.braspagPaymentId,
    String(consult.statusCode ?? "-"),
  );

  // 2 = PaymentConfirmed
  if (consult.statusCode === 2) {
    // Marca pago ANTES de criar a reserva (estreita corrida entre vias).
    if (draft.status !== "paid") {
      await updateDraft(draftId, { status: "paid" });
    }
    await criarReservaSeNecessario(draftId, draft);
    return { status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` };
  }

  // 3 = Denied, 13 = Aborted, 10 = Voided, 11 = Refunded → falha do Pix
  if (
    consult.statusCode === 3 ||
    consult.statusCode === 13 ||
    consult.statusCode === 10 ||
    consult.statusCode === 11
  ) {
    await updateDraft(draftId, { status: "failed" });
    return { status: "failed" };
  }

  return { status: "pending" };
}

// Mesmo pós-pagamento do fluxo de cartão (Hostaway + alertas + fallback -1).
async function criarReservaSeNecessario(draftId: string, draftSnapshot: ReservationDraft) {
  // Re-lê o draft: outra via pode ter criado a reserva entre o consult e aqui.
  const draft = (await getDraft(draftId)) ?? draftSnapshot;
  if (draft.hostawayReservationId !== undefined) return; // já criada (ou -1)

  const property = getPropertyBySlug(draft.propertyId);
  if (!property) return;

  const totalDiscount = (draft.couponDiscount || 0) + (draft.pixDiscount || 0);
  const reservation = await createHostawayReservation({
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
  });

  if (reservation) {
    await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
    const opExtrasForEmail = await blockOpExtraNights(property.slug, draft.opExtras);
    console.log("📧 NOVA RESERVA PAGA (Pix Braspag):", {
      hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
      propriedade: draft.propertyName,
      checkin: draft.checkin,
      checkout: draft.checkout,
      valorCobrado: `R$ ${draft.finalTotal.toFixed(2)}`,
      metodo: "Pix",
      hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
      braspagId: draft.braspagPaymentId,
    });
    await enviarAlertaAprovacao({
      hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
      propriedade: draft.propertyName,
      valor: draft.finalTotal,
      checkin: draft.checkin,
      checkout: draft.checkout,
      noites: draft.nights,
      metodo: "Pix",
      hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
      shortNotice: draft.shortNotice,
      serviceExtras: enrichServiceExtras(draft.serviceExtras),
      opExtras: opExtrasForEmail,
    });
  } else {
    // Pago, Hostaway falhou → criação manual (mesmo fallback dos outros fluxos).
    await updateDraft(draftId, { hostawayReservationId: -1 });
    console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY (Pix Braspag) 🚨🚨🚨");
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
          pagamento: "Pix (Braspag)",
          braspagPaymentId: draft.braspagPaymentId,
          draftId,
        },
        null,
        2,
      ),
    );
  }
}
