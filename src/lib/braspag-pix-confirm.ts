import { getDraft, updateDraft, type ReservationDraft } from "@/lib/kv-store";
import { consultBraspagPayment } from "@/lib/braspag";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { enviarAlertaAprovacao } from "@/lib/email";
import { registerOrphanAndAlert } from "@/lib/reservation-recovery";

// =============================================================================
// Confirmação de Pix Braspag por CONSULTA — helper ÚNICO.
// A Braspag NÃO tem webhook de Pix: o status é acompanhado pela API de Consulta
// (NotPaid / Paid / Expired). Este helper é chamado por 3 entradas:
//   (1) polling da página (/api/payments/braspag/pix/status) — confirma na hora
//       se o hóspede está com a página aberta;
//   (2) reconciliação/CRON (/api/payments/braspag/pix-reconcile) — rede de
//       segurança que varre pendentes;
//   (3) webhook (/api/webhooks/braspag) — mantido para eventos de CARTÃO; se um
//       dia notificar Pix, reusa esta função (inofensivo).
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

// Códigos de retorno do provider Pix que indicam EXPIRAÇÃO do QR (o pagamento
// não ocorreu no prazo). São específicos do provider (ex.: Bradesco 124=Expirado,
// 130=QRCode removido/vencido). VALIDAR EM PRODUÇÃO: confirmar os códigos do
// provider de produção; o Payment.Status numérico continua sendo a fonte primária.
const EXPIRED_PROVIDER_CODES = new Set(["124", "130"]);

// Confirmação de Pix por CONSULTA (a Braspag NÃO tem webhook de Pix: o status é
// acompanhado pela API de Consulta — NotPaid/Paid/Expired). Idempotente.
export async function confirmPixPaymentIfPaid(draftId: string): Promise<PixConfirmResult> {
  const draft = await getDraft(draftId);
  if (!draft) return { status: "expired" };

  // GUARD CRÍTICO: CARTÃO é resolvido SINCRONAMENTE no /api/payments/braspag/credit
  // (autoriza → antifraude → captura → reserva, tudo na requisição). Uma
  // notificação de webhook de cartão NÃO pode passar pela confirmação de Pix:
  // numa corrida com a criação síncrona da reserva, geraria um ÓRFÃO FALSO
  // (foi o bug observado em produção). Cobre TODOS os chamadores (ambos webhooks,
  // reconcile, polling). Aqui só reportamos o estado; nunca criamos reserva.
  if (draft.paymentMethod === "card") {
    return draft.status === "paid"
      ? { status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` }
      : { status: "pending" };
  }

  // Estados terminais: não reconsulta (idempotência + para de sondar).
  if (draft.status === "paid" && draft.hostawayReservationId !== undefined) {
    return { status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` };
  }
  if (draft.status === "failed") return { status: "failed" };
  if (draft.status === "expired") return { status: "expired" };
  if (!draft.braspagPaymentId) return { status: "pending" };

  // Reconsulta server-side — única fonte de verdade do status.
  const consult = await consultBraspagPayment(draft.braspagPaymentId);
  const payment = ((consult.raw ?? {}) as { Payment?: Record<string, unknown> }).Payment ?? {};
  const provCode = String(payment.ProviderReturnCode ?? payment.ReasonCode ?? "");
  console.log(
    "[BraspagPix:confirm] draft=%s paymentId=%s status=%s provCode=%s",
    draftId,
    draft.braspagPaymentId,
    String(consult.statusCode ?? "-"),
    provCode || "-",
  );

  // Paid — 2 = PaymentConfirmed.
  if (consult.statusCode === 2) {
    // Marca pago ANTES de criar a reserva (estreita corrida entre vias).
    if (draft.status !== "paid") {
      await updateDraft(draftId, { status: "paid" });
    }
    await criarReservaSeNecessario(draftId, draft);
    return { status: "paid", redirectTo: `/reservar/${draftId}/confirmacao` };
  }

  // Expired — QR venceu sem pagamento. Marca "expired" e para de reconsultar
  // (o reconcile só varre drafts "pending").
  if (EXPIRED_PROVIDER_CODES.has(provCode)) {
    await updateDraft(draftId, { status: "expired" });
    return { status: "expired" };
  }

  // Failed — 3=Denied, 13=Aborted, 10=Voided, 11=Refunded.
  if (
    consult.statusCode === 3 ||
    consult.statusCode === 13 ||
    consult.statusCode === 10 ||
    consult.statusCode === 11
  ) {
    await updateDraft(draftId, { status: "failed" });
    return { status: "failed" };
  }

  // NotPaid (12=Pending ou indefinido) → segue pendente.
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
  const reservationParams = {
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
    paymentMethod: "pix" as const,
    currency: "BRL",
    guestNotes: draft.guestNotes || "",
    source: "solarium-direct",
    packageName: draft.packageName,
    extrasList: draft.extrasList,
    shortNotice: draft.shortNotice,
    serviceExtras: enrichServiceExtras(draft.serviceExtras),
    opExtras: draft.opExtras,
    ...paramsDePacote(draft),
  };

  // Bloquear ANTES de criar: sem isso, da para aceitar reserva nova com o hospede
  // ainda na casa ate as 18h.
  const bloqueio = await blockOpExtraNights(property.slug, draft);
  const reservation = bloqueio.todasBloqueadas
    ? await createHostawayReservation(reservationParams)
    : null;

  if (reservation) {
    await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
    const opExtrasForEmail = bloqueio.resultados;
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
    // DEFESA (item 4): antes de tratar como órfão, re-lê o draft. Se a reserva
    // JÁ existe (outra via a criou entre o consult e aqui, ou o createHostaway
    // falhou por DUPLICIDADE de uma reserva já existente), NÃO é órfão — é apenas
    // notificação tardia da mesma transação concluída. Evita alerta falso.
    const fresh = await getDraft(draftId);
    if (fresh && typeof fresh.hostawayReservationId === "number" && fresh.hostawayReservationId > 0) {
      console.log("[BraspagPix:confirm] reserva já existe — notificação tardia, sem órfão:", draftId);
      return;
    }
    // SALVAGUARDA: pago, Hostaway falhou de fato → alerta imediato + órfão.
    await updateDraft(draftId, { hostawayReservationId: -1 });
    console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY (Pix Braspag) 🚨🚨🚨");
    await registerOrphanAndAlert({
      paymentId: draft.braspagPaymentId || draftId,
      draftId,
      method: "pix",
      error: "createHostawayReservation retornou null (Pix pago)",
      reservationParams,
      noites: draft.nights,
    });
  }
}
