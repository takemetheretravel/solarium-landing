import {
  getDraft,
  updateDraft,
  findDraftEmAnalisePorPaymentId,
  adquirirTravaExclusiva,
  liberarTravaExclusiva,
  lerTravaExclusiva,
  gravarMarcador,
  reservarEnvioUnico,
  type ReservationDraft,
  type BloqueioAnalise,
} from "@/lib/kv-store";
import {
  consultBraspagPayment,
  captureBraspagPayment,
  normalizarFraudStatus,
  nomeFraudStatus,
  redigirParaRegistro,
  type FraudStatusNome,
} from "@/lib/braspag";
import {
  createHostawayReservation,
  blockCalendarNight,
  unblockCalendarNight,
  noitesDaEstadia,
} from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { enviarAlertaAprovacao, enviarAlertaDesfechoAnalise } from "@/lib/email";
import { registerOrphanAndAlert } from "@/lib/reservation-recovery";
import { enviarEmailDesfechoUmaVez } from "@/lib/comunicacao-analise";

// =============================================================================
// Desfecho do Review do antifraude (rodada A3).
//
// NÃO usa o ChangeType como gatilho. A Braspag não documentou qual código carrega
// a decisão do analista, e o volume de cartão é baixo demais para descobrir na
// prática. Para QUALQUER notificação cujo PaymentId seja de um draft em
// `aguardando_analise`, consulta a transação (GET /v2/sales/{id}) e resolve pelo
// estado real. O ChangeType vira informação de log.
//
// Um caminho só: webhook Braspag, webhook Cielo (é para lá que o portal de
// produção aponta) e a reconciliação manual chamam reconciliarPagamentoEmAnalise.
//
// IDEMPOTÊNCIA — capturar duas vezes ou criar duas reservas é o pior defeito
// possível aqui. Três camadas, todas verificadas antes de qualquer efeito:
//   1. marcador definitivo `reconciliacao:<PaymentId>:aceito|recusado` (30 dias);
//   2. trava de processamento `reconciliacao:<PaymentId>:processando` (2 min),
//      fail-closed: Redis fora do ar não autoriza efeito;
//   3. releitura do draft dentro da trava: só segue se ainda estiver em análise.
// Captura que falha NÃO grava marcador e solta a trava: a próxima notificação ou
// a rota manual tenta de novo.
// =============================================================================

export type OrigemReconciliacao = "webhook-braspag" | "webhook-cielo" | "manual";

export type ResultadoReconciliacao =
  | { resultado: "sem-analise" }
  | { resultado: "ja-resolvido"; desfecho: string }
  | { resultado: "em-andamento" }
  | { resultado: "ainda-em-analise"; fraudStatus: FraudStatusNome }
  | { resultado: "indefinido"; fraudStatus: FraudStatusNome; paymentStatus: number | null }
  | { resultado: "aceito"; reservationId: number | null; capturadoAgora: boolean }
  | { resultado: "captura-falhou"; statusCode: number | null; returnCode: string | null }
  | { resultado: "recusado"; noitesNaoLiberadas: BloqueioAnalise[] }
  | { resultado: "erro"; motivo: string };

const TTL_TRAVA_PROCESSAMENTO = 120;
const TTL_MARCADOR = 60 * 60 * 24 * 30;

const chaveMarcador = (paymentId: string, desfecho: "aceito" | "recusado") => `reconciliacao:${paymentId}:${desfecho}`;

// Status do Payment na Braspag: 1 autorizado, 2 capturado, 10 cancelado,
// 11 estornado, 13 abortado.
const PAGAMENTO_AUTORIZADO = 1;
const PAGAMENTO_CAPTURADO = 2;
const PAGAMENTO_ENCERRADO_SEM_CAPTURA = [10, 11, 13];

async function desfechoJaGravado(paymentId: string): Promise<string | null | "erro"> {
  try {
    for (const desfecho of ["aceito", "recusado"] as const) {
      if (await lerTravaExclusiva(chaveMarcador(paymentId, desfecho))) return desfecho;
    }
    return null;
  } catch (e) {
    console.error("[Reconciliacao] falha ao ler marcador (fail-closed):", e);
    return "erro";
  }
}

function contexto(draft: ReservationDraft) {
  return {
    hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
    propriedade: draft.propertyName,
    valor: draft.analise?.valorAutorizado ?? draft.finalTotal,
    checkin: draft.checkin,
    checkout: draft.checkout,
    paymentId: draft.analise?.paymentId ?? "",
    draftId: draft.id,
  };
}

/**
 * Filtro barato para os webhooks: só devolve resultado quando existe draft em
 * análise para o PaymentId. `null` = a notificação não é deste fluxo e o webhook
 * segue o comportamento de antes. Nunca lança.
 */
export async function reconciliarSeEmAnalise(
  paymentId: unknown,
  origem: OrigemReconciliacao,
  changeType: unknown,
): Promise<ResultadoReconciliacao | null> {
  if (typeof paymentId !== "string" || !paymentId.trim()) return null;
  try {
    const draft = await findDraftEmAnalisePorPaymentId(paymentId);
    if (!draft) return null;
    return await reconciliarPagamentoEmAnalise(paymentId.trim(), origem, changeType);
  } catch (e) {
    console.error("[Reconciliacao] erro inesperado:", e);
    return { resultado: "erro", motivo: String(redigirParaRegistro((e as Error)?.message ?? String(e))) };
  }
}

export async function reconciliarPagamentoEmAnalise(
  paymentId: string,
  origem: OrigemReconciliacao,
  changeType?: unknown,
): Promise<ResultadoReconciliacao> {
  const log = (etapa: string, extra: Record<string, unknown> = {}) =>
    console.log(
      "[Reconciliacao] " +
        JSON.stringify({ etapa, paymentId, origem, changeType: redigirParaRegistro(changeType ?? null), ...extra }),
    );

  // 1) Desfecho já aplicado?
  const antes = await desfechoJaGravado(paymentId);
  if (antes === "erro") return { resultado: "erro", motivo: "Redis indisponível ao ler o marcador" };
  if (antes) {
    log("ja-resolvido", { desfecho: antes });
    return { resultado: "ja-resolvido", desfecho: antes };
  }

  const encontrado = await findDraftEmAnalisePorPaymentId(paymentId);
  if (!encontrado) {
    log("sem-analise");
    return { resultado: "sem-analise" };
  }

  // 2) Trava de processamento, fail-closed.
  const chaveTrava = `reconciliacao:${paymentId}:processando`;
  const trava = await adquirirTravaExclusiva(chaveTrava, TTL_TRAVA_PROCESSAMENTO);
  if (trava === "ocupada") {
    log("em-andamento");
    return { resultado: "em-andamento" };
  }
  if (trava === "erro") return { resultado: "erro", motivo: "Redis indisponível ao adquirir a trava" };

  try {
    // 3) Releitura dentro da trava: outra execução pode ter terminado entre o
    // passo 1 e a trava.
    const depois = await desfechoJaGravado(paymentId);
    if (depois === "erro") return { resultado: "erro", motivo: "Redis indisponível ao reler o marcador" };
    if (depois) return { resultado: "ja-resolvido", desfecho: depois };
    const draft = await getDraft(encontrado.id);
    if (!draft || draft.status !== "aguardando_analise" || draft.analise?.paymentId !== encontrado.analise?.paymentId) {
      return { resultado: "ja-resolvido", desfecho: draft?.status ?? "draft ausente" };
    }

    // 4) Estado real na Braspag.
    const consulta = await consultBraspagPayment(paymentId);
    const pagamento = ((consulta.raw ?? {}) as { Payment?: Record<string, unknown> }).Payment;
    if (consulta.status < 200 || consulta.status >= 300 || !pagamento) {
      log("consulta-falhou", { http: consulta.status });
      return { resultado: "erro", motivo: `consulta à Braspag falhou (HTTP ${consulta.status})` };
    }
    const fa = (pagamento.FraudAnalysis ?? {}) as Record<string, unknown>;
    const fraud = normalizarFraudStatus(fa.Status);
    const paymentStatus = typeof pagamento.Status === "number" ? pagamento.Status : null;
    log("consultado", { fraudStatus: nomeFraudStatus(fraud), fraudStatusCru: redigirParaRegistro(fa.Status ?? null), paymentStatus });

    if (fraud === 3) return { resultado: "ainda-em-analise", fraudStatus: "Review" };
    if (fraud === 1) return await aceitar(draft, paymentStatus, origem);
    if (fraud === 2) return await recusar(draft, origem);

    // Sem Accept/Reject legível. Dois sinais do próprio pagamento bastam:
    // já capturado (alguém capturou pelo portal) ou encerrado sem captura (o
    // gateway cancela sozinho em Reject).
    if (paymentStatus === PAGAMENTO_CAPTURADO) return await aceitar(draft, paymentStatus, origem);
    if (paymentStatus !== null && PAGAMENTO_ENCERRADO_SEM_CAPTURA.includes(paymentStatus)) {
      return await recusar(draft, origem);
    }

    if (await reservarEnvioUnico(`alerta:indefinido:${paymentId}`, TTL_MARCADOR)) {
      await enviarAlertaDesfechoAnalise({
        tipo: "indefinido",
        ...contexto(draft),
        origem,
        detalhe: `FraudAnalysis ${nomeFraudStatus(fraud)} · Payment.Status ${paymentStatus ?? "ausente"}`,
      });
    }
    return { resultado: "indefinido", fraudStatus: nomeFraudStatus(fraud), paymentStatus };
  } finally {
    await liberarTravaExclusiva(chaveTrava);
  }
}

// ---------------------------------------------------------------------------
// ACCEPT
// ---------------------------------------------------------------------------
async function aceitar(
  draft: ReservationDraft,
  paymentStatus: number | null,
  origem: OrigemReconciliacao,
): Promise<ResultadoReconciliacao> {
  const analise = draft.analise!;
  const paymentId = analise.paymentId;
  let capturadoAgora = false;

  if (paymentStatus !== PAGAMENTO_CAPTURADO) {
    const falhar = async (statusCode: number | null, returnCode: string | null, detalhe: string) => {
      const tentativas = [
        ...(analise.tentativasCaptura ?? []),
        { em: new Date().toISOString(), origem, statusCode, returnCode },
      ];
      // Continua em análise, com as noites seguradas: é isso que permite tentar de novo.
      await updateDraft(draft.id, { analise: { ...analise, tentativasCaptura: tentativas } });
      console.error("[Reconciliacao:CapturaFalhou] " + JSON.stringify({ paymentId, origem, statusCode, returnCode, tentativas: tentativas.length }));
      await enviarAlertaDesfechoAnalise({
        tipo: "captura-falhou",
        ...contexto(draft),
        origem,
        detalhe: `${detalhe} · tentativa ${tentativas.length}`,
      });
      return { resultado: "captura-falhou" as const, statusCode, returnCode };
    };

    if (paymentStatus !== PAGAMENTO_AUTORIZADO) {
      return falhar(paymentStatus, null, `autorização não está mais viva (Payment.Status ${paymentStatus ?? "ausente"})`);
    }
    const cap = await captureBraspagPayment(paymentId, analise.valorAutorizadoCentavos);
    if (cap.statusCode !== PAGAMENTO_CAPTURADO) {
      return falhar(
        typeof cap.statusCode === "number" ? cap.statusCode : null,
        cap.returnCode ?? null,
        `PUT /capture devolveu HTTP ${cap.status}, status ${cap.statusCode ?? "?"}, código ${cap.returnCode ?? "?"}`,
      );
    }
    capturadoAgora = true;
  }

  // Capturado. Daqui em diante nada pode rodar duas vezes: marcador primeiro.
  await gravarMarcador(chaveMarcador(paymentId, "aceito"), new Date().toISOString(), TTL_MARCADOR);
  const desfecho = { resultado: "aceito" as const, em: new Date().toISOString(), origem };
  await updateDraft(draft.id, { status: "paid", braspagPaymentId: paymentId, analise: { ...analise, desfecho } });

  const reservationId = await criarReservaAposAceite(draft);
  console.log("[Reconciliacao:Aceito] " + JSON.stringify({ paymentId, origem, capturadoAgora, reservationId }));
  return { resultado: "aceito", reservationId, capturadoAgora };
}

/**
 * Mesma reserva que a rota de crédito cria no Accept direto, com uma diferença:
 * as noites da estadia estão bloqueadas por nós desde a A2a. A Hostaway pode
 * recusar criar reserva sobre noite indisponível, então elas são LIBERADAS logo
 * antes de criar. Se a criação falhar, são bloqueadas de novo para segurar as
 * datas até a criação manual (o pagamento já foi capturado).
 *
 * Os bloqueios de early/late ficam como estão: continuam necessários com a
 * reserva, e blockOpExtraNights os reafirma.
 */
async function criarReservaAposAceite(draft: ReservationDraft): Promise<number | null> {
  const analise = draft.analise!;
  const property = getPropertyBySlug(draft.propertyId);
  if (!property) {
    console.error("🚨 PAGO SEM RESERVA (após revisão) — propriedade não resolvida " + JSON.stringify({ draftId: draft.id, paymentId: analise.paymentId }));
    return null;
  }

  const noitesEstadia = new Set(noitesDaEstadia(draft.checkin, draft.checkout));
  const daEstadia = analise.bloqueios.filter((b) => noitesEstadia.has(b.noite));
  for (const b of daEstadia) {
    if (!(await unblockCalendarNight(b.listingId, b.noite))) {
      console.error(`[Reconciliacao] não liberou ${b.noite} (listing ${b.listingId}) antes de criar a reserva`);
    }
  }

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
    totalPrice: analise.valorAutorizado,
    subtotalOriginal: draft.subtotal ?? draft.totalPrice,
    discountAmount: totalDiscount,
    couponCode: draft.couponCode,
    installments: analise.parcelas,
    paymentMethod: "card" as const,
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

  const bloqueio = await blockOpExtraNights(property.slug, draft);
  if (!bloqueio.todasBloqueadas) console.error("[Reserva] BLOQUEIO FALHOU — reserva nao criada (após revisão)", draft.id);
  const reservation = bloqueio.todasBloqueadas ? await createHostawayReservation(reservationParams) : null;

  if (!reservation) {
    for (const b of daEstadia) await blockCalendarNight(b.listingId, b.noite);
    await updateDraft(draft.id, { hostawayReservationId: -1 });
    console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY (Braspag cartão, após revisão) 🚨🚨🚨");
    await registerOrphanAndAlert({
      paymentId: analise.paymentId,
      draftId: draft.id,
      method: "card",
      error: "createHostawayReservation retornou null (cartão capturado após revisão do antifraude)",
      reservationParams,
      noites: draft.nights,
    });
    return null;
  }

  await updateDraft(draft.id, { hostawayReservationId: reservation.reservationId });
  const hostawayUrl = `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`;
  await enviarAlertaAprovacao({
    pacoteNome: draft.pacoteNome,
    extrasProvidenciar: extrasProvidenciar(draft),
    dataLimiteCancelamentoExtras: draft.dataLimiteCancelamentoExtras,
    hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
    propriedade: draft.propertyName,
    valor: analise.valorAutorizado,
    checkin: draft.checkin,
    checkout: draft.checkout,
    noites: draft.nights,
    metodo: `Cartão ${analise.parcelas}x — aprovado após revisão do antifraude`,
    hostawayUrl,
    shortNotice: draft.shortNotice,
    serviceExtras: enrichServiceExtras(draft.serviceExtras),
    opExtras: bloqueio.resultados,
  });
  const email = await enviarEmailDesfechoUmaVez("confirmacao", draft, draft.id);
  console.log("[Reconciliacao] e-mail de confirmação ao hóspede: " + email);
  return reservation.reservationId;
}

// ---------------------------------------------------------------------------
// REJECT
// ---------------------------------------------------------------------------
async function recusar(draft: ReservationDraft, origem: OrigemReconciliacao): Promise<ResultadoReconciliacao> {
  const analise = draft.analise!;
  // Sem void: em Reject o gateway cancela a autorização sozinho.
  await gravarMarcador(chaveMarcador(analise.paymentId, "recusado"), new Date().toISOString(), TTL_MARCADOR);

  const naoLiberadas: BloqueioAnalise[] = [];
  for (const b of analise.bloqueios) {
    if (!(await unblockCalendarNight(b.listingId, b.noite))) naoLiberadas.push(b);
  }

  const desfecho = { resultado: "recusado" as const, em: new Date().toISOString(), origem };
  await updateDraft(draft.id, { status: "failed", analise: { ...analise, desfecho } });

  const email = await enviarEmailDesfechoUmaVez("nao-concluido", draft, draft.id);
  await enviarAlertaDesfechoAnalise({
    tipo: "recusado",
    ...contexto(draft),
    origem,
    detalhe:
      `e-mail ao cliente: ${email}` +
      (naoLiberadas.length
        ? ` · NÃO LIBERADAS, liberar à mão: ${naoLiberadas.map((b) => `${b.noite}/${b.listingId}`).join(", ")}`
        : " · todas as noites liberadas"),
  });
  console.log("[Reconciliacao:Recusado] " + JSON.stringify({ paymentId: analise.paymentId, origem, naoLiberadas: naoLiberadas.length }));
  return { resultado: "recusado", noitesNaoLiberadas: naoLiberadas };
}
