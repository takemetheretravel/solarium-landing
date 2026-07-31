import {
  getDraft,
  updateDraft,
  saveOrphanReservation,
  deleteOrphanReservation,
} from "@/lib/kv-store";
import { createHostawayReservation } from "@/lib/hostaway";
import { enviarAlertaPagamentoSemReserva, enviarAlertaAprovacao } from "@/lib/email";
import { enrichServiceExtras } from "@/config/service-extras";

// =============================================================================
// Salvaguarda: pagamento CONFIRMADO cuja reserva no Hostaway falhou.
// (Decisão de negócio: SEM hold de datas; só a salvaguarda contra pagamento
// pago sem reserva.) Dois momentos:
//  - registerOrphanAndAlert(): chamado no ato da falha → alerta imediato por
//    e-mail + persiste o "órfão" no KV com TUDO para recriar depois.
//  - reprocessOrphan(): chamado pela reconciliação → tenta criar a reserva de
//    novo, idempotente; em sucesso, resolve o draft e remove o órfão.
// =============================================================================

// Args EXATOS de createHostawayReservation — guardados para recriar sem depender
// do draft (que pode expirar em 2h; o órfão dura 30 dias).
export type ReservationParams = Parameters<typeof createHostawayReservation>[0];

export type OrphanRecord = {
  paymentId: string;
  draftId: string;
  method: "pix" | "card";
  error: string;
  createdAt: string;
  reservationParams: ReservationParams;
  alert: {
    hospede: string;
    propriedade: string;
    valor: number;
    checkin: string;
    checkout: string;
    noites: number;
    email: string;
    telefone: string;
  };
};

export async function registerOrphanAndAlert(input: {
  paymentId: string;
  draftId: string;
  method: "pix" | "card";
  error: string;
  reservationParams: ReservationParams;
  noites: number;
}): Promise<void> {
  const p = input.reservationParams;
  const record: OrphanRecord = {
    paymentId: input.paymentId,
    draftId: input.draftId,
    method: input.method,
    error: input.error,
    createdAt: new Date().toISOString(),
    reservationParams: p,
    alert: {
      hospede: `${p.guestFirstName} ${p.guestLastName}`,
      propriedade: p.packageName ? `${p.packageName}` : String(p.listingMapId),
      valor: p.totalPrice,
      checkin: p.arrivalDate,
      checkout: p.departureDate,
      noites: input.noites,
      email: p.guestEmail,
      telefone: p.phone,
    },
  };

  // Persiste primeiro (fonte de verdade para o reprocess), depois alerta.
  await saveOrphanReservation(input.paymentId, record);
  await enviarAlertaPagamentoSemReserva({
    metodo: input.method,
    hospede: record.alert.hospede,
    propriedade: record.alert.propriedade,
    valor: record.alert.valor,
    checkin: record.alert.checkin,
    checkout: record.alert.checkout,
    email: record.alert.email,
    telefone: record.alert.telefone,
    paymentId: input.paymentId,
    draftId: input.draftId,
    erro: input.error,
  });
  console.error(
    "[Recovery] ÓRFÃO registrado (pago sem reserva):",
    JSON.stringify({ paymentId: input.paymentId, draftId: input.draftId, method: input.method, error: input.error }),
  );
}

// Reprocessa um órfão: tenta criar a reserva de novo. Idempotente:
//  - se o draft já tem hostawayReservationId positivo → já resolvido → remove órfão;
//  - senão, tenta criar; em sucesso, grava no draft (se existir), alerta aprovação
//    e remove o órfão; em falha, mantém o órfão para a próxima rodada.
export async function reprocessOrphan(record: OrphanRecord): Promise<"resolved" | "created" | "failed"> {
  const draft = await getDraft(record.draftId);
  if (draft && typeof draft.hostawayReservationId === "number" && draft.hostawayReservationId > 0) {
    await deleteOrphanReservation(record.paymentId);
    return "resolved";
  }

  const reservation = await createHostawayReservation(record.reservationParams);
  if (!reservation) {
    console.error("[Recovery] reprocess falhou de novo:", record.paymentId, record.draftId);
    return "failed";
  }

  if (draft) {
    await updateDraft(record.draftId, { hostawayReservationId: reservation.reservationId, status: "paid" });
  }
  await deleteOrphanReservation(record.paymentId);
  console.log(
    "[Recovery] ✅ Reserva criada na reconciliação p/ órfão:",
    JSON.stringify({ paymentId: record.paymentId, draftId: record.draftId, reservationId: reservation.reservationId }),
  );
  // Alerta de aprovação (a reserva finalmente nasceu).
  await enviarAlertaAprovacao({
    hospede: record.alert.hospede,
    propriedade: record.alert.propriedade,
    valor: record.alert.valor,
    checkin: record.alert.checkin,
    checkout: record.alert.checkout,
    noites: record.alert.noites,
    metodo: record.method === "pix" ? "Pix" : "Cartão",
    hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
    serviceExtras: enrichServiceExtras(record.reservationParams.serviceExtras),
    opExtras: record.reservationParams.opExtras?.map((e) => ({ label: e.label, blockedNight: e.blockedNight })),
  });
  return "created";
}
