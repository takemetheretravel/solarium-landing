import { Redis } from "@upstash/redis";

if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  console.error("[kv-store] Nenhuma variável Redis configurada (KV_REST_API_URL ou UPSTASH_REDIS_REST_URL)");
}

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
    if (!url || !token) {
      throw new Error("[kv-store] Redis não configurado — defina KV_REST_API_URL e KV_REST_API_TOKEN");
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const DRAFT_TTL = 60 * 60 * 2; // 2 horas

export type ReservationDraft = {
  id: string;
  propertyId: string;
  propertyName: string;
  checkin: string;
  checkout: string;
  guests: number;
  nights: number;
  totalPrice: number;
  subtotal?: number; // valor antes do desconto (= totalPrice; alias semântico)
  pixDiscount: number;
  couponCode?: string;
  couponDiscount: number;
  discountAmount?: number; // valor descontado total (cupom + pix)
  finalTotal: number;
  paymentMethod: "pix" | "card";
  packageSlug?: string;
  packageName?: string;
  extrasTotal?: number;
  extrasList?: string[];
  shortNotice?: boolean; // pacote com check-in < 3 dias: acionar parceiros com urgência
  serviceExtras?: { id: string; label: string; qty: number; price: number }[];
  opExtras?: { type: string; label: string; price: number; blockedNight: string }[];
  // --- Pacotes V2 ---
  /** Id do pacote V2. Sua presença bloqueia cupom no recálculo server-side. */
  pacoteId?: string;
  pacoteNome?: string;
  /** Linhas de preço do pacote, já revalidadas server-side. */
  pacoteItens?: {
    extraId: string;
    nome: string;
    qtd: number;
    precoUnitario: number;
    total: number;
    entraNaBase: boolean;
    incluso: boolean;
  }[];
  /** Base sobre a qual o progressivo incidiu (Hostaway + operacionais). */
  baseDesconto?: number;
  descontoProgressivo?: number;
  bonusSaida?: number;
  /** Economia frente à contratação avulsa dos mesmos itens, em reais. */
  economiaVsAvulso?: number;
  /** Data-limite de cancelamento dos extras com reembolso integral (ISO). */
  dataLimiteCancelamentoExtras?: string;
  /** Reserva criada a partir do preview de teste. */
  reservaTeste?: boolean;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCpf: string;
  guestNotes?: string;
  // --- Identificadores de medição, capturados na criação do draft ---
  // O envio de conversão server-side acontece depois do webhook, quando o
  // navegador do cliente já não está por perto. Sem estes campos gravados aqui,
  // GA4 e Meta não conseguem atribuir a conversão à sessão que a originou.
  /** client_id do GA4 (cookie _ga). */
  gaClientId?: string;
  /** Cookie _fbp do Meta Pixel. */
  fbp?: string;
  /** Cookie _fbc do Meta Pixel (clique de anúncio). */
  fbc?: string;
  /** session_id do GA4 (cookie _ga_<STREAM>). */
  gaSessionId?: string;
  /** Id da tentativa de checkout, aberto no clique do CTA "Reservar". */
  checkoutId?: string;
  /** Origem da sessão: gclid e utm_*, capturados na primeira página. */
  atribuicao?: {
    gclid?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    landing_page?: string;
    capturado_em?: string;
  } | null;
  status: "pending" | "paid" | "failed" | "expired";
  cieloPaymentId?: string;
  braspagPaymentId?: string;
  hostawayReservationId?: number;
  createdAt: string;
  expiresAt: string;
};

export async function saveDraft(draft: ReservationDraft): Promise<void> {
  try {
    await getRedis().set(`draft:${draft.id}`, JSON.stringify(draft), { ex: DRAFT_TTL });
  } catch (err) {
    console.error("[kv-store:saveDraft] Failed:", err);
    throw err;
  }
}

export async function getDraft(id: string): Promise<ReservationDraft | null> {
  try {
    const raw = await getRedis().get<string>(`draft:${id}`);
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as ReservationDraft) : (raw as unknown as ReservationDraft);
  } catch (err) {
    console.error("[kv-store:getDraft] Failed:", err);
    return null;
  }
}

// Varre todos os drafts vivos no Redis (SCAN draft:*). Como o TTL do draft é
// 2h, isso cobre com folga a janela de reconciliação de Pix pendente — não há
// draft com mais de 2h no store. Usado pelo pix-reconcile.
export async function scanAllDrafts(): Promise<ReservationDraft[]> {
  try {
    const redis = getRedis();
    const keys: string[] = [];
    let cursor = 0;
    do {
      const [next, batch] = await redis.scan(cursor, { match: "draft:*", count: 100 });
      cursor = Number(next);
      keys.push(...batch);
    } while (cursor !== 0);
    if (keys.length === 0) return [];

    const values = await redis.mget<(string | ReservationDraft | null)[]>(...keys);
    const drafts: ReservationDraft[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        drafts.push(typeof raw === "string" ? (JSON.parse(raw) as ReservationDraft) : (raw as ReservationDraft));
      } catch {
        // entrada corrompida: ignora
      }
    }
    return drafts;
  } catch (err) {
    console.error("[kv-store:scanAllDrafts] Failed:", err);
    return [];
  }
}

// Encontra um draft cujo braspagPaymentId == id (ignora vazio). Usado pelo
// webhook Cielo para detectar notificações que são, na verdade, de Pix Braspag
// (a URL cadastrada no portal Braspag de produção é o endpoint /webhooks/cielo).
export async function findDraftByBraspagPaymentId(id: string): Promise<ReservationDraft | null> {
  const needle = (id || "").trim();
  if (!needle) return null;
  const drafts = await scanAllDrafts();
  return drafts.find((d) => d.braspagPaymentId === needle) ?? null;
}

// ---------------------------------------------------------------------------
// Órfãos: pagamento CONFIRMADO cuja reserva no Hostaway falhou. Persistidos p/
// a reconciliação reprocessar (recriar a reserva). Chave braspag:pix-orfao:<id>.
// TTL 30 dias (bem além do TTL do draft — o pagamento já existe e não pode
// ficar sem reserva). O record carrega tudo p/ recriar sem depender do draft.
const ORPHAN_PREFIX = "braspag:pix-orfao:";
const ORPHAN_TTL = 60 * 60 * 24 * 30; // 30 dias

export async function saveOrphanReservation(paymentId: string, record: unknown): Promise<void> {
  try {
    await getRedis().set(`${ORPHAN_PREFIX}${paymentId}`, JSON.stringify(record), { ex: ORPHAN_TTL });
  } catch (err) {
    console.error("[kv-store:saveOrphanReservation] Failed:", err);
  }
}

export async function scanOrphanReservations<T = unknown>(): Promise<T[]> {
  try {
    const keys = await scanKeys(`${ORPHAN_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | T | null)[]>(...keys);
    const out: T[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T));
      } catch {
        // ignora corrompido
      }
    }
    return out;
  } catch (err) {
    console.error("[kv-store:scanOrphanReservations] Failed:", err);
    return [];
  }
}

export async function deleteOrphanReservation(paymentId: string): Promise<void> {
  try {
    await getRedis().del(`${ORPHAN_PREFIX}${paymentId}`);
  } catch (err) {
    console.error("[kv-store:deleteOrphanReservation] Failed:", err);
  }
}

// ---------------------------------------------------------------------------
// webhook_events — registro único por (payment_id, change_type).
//
// A janela precisa cobrir reentregas TARDIAS: houve caso de a mesma notificação
// voltar 109 minutos depois. O TTL de 30 dias cobre com folga, ao custo de uma
// chave curta por evento.
const WEBHOOK_EVENT_PREFIX = "webhook_events:";
const WEBHOOK_EVENT_TTL = 60 * 60 * 24 * 30; // 30 dias

export type WebhookEvent = {
  payment_id: string;
  change_type: string;
  source: string;
  received_at: string;
  processed_at: string | null;
};

function chaveEvento(paymentId: string, changeType: string | number): string {
  return `${WEBHOOK_EVENT_PREFIX}${paymentId}:${changeType}`;
}

/**
 * Tenta inserir o evento. `inserted: true` = é a PRIMEIRA vez e o chamador deve
 * processar; `false` = duplicata, ignorar sem nenhum efeito colateral.
 *
 * Falha de Redis é fail-open (`inserted: true`): perder um pagamento é pior que
 * processá-lo duas vezes, e os efeitos a jusante têm suas próprias guardas.
 */
export async function insertWebhookEvent(params: {
  paymentId: string;
  changeType: string | number;
  source: string;
}): Promise<{ inserted: boolean; event: WebhookEvent }> {
  const event: WebhookEvent = {
    payment_id: params.paymentId,
    change_type: String(params.changeType),
    source: params.source,
    received_at: new Date().toISOString(),
    processed_at: null,
  };
  try {
    const res = await getRedis().set(
      chaveEvento(params.paymentId, params.changeType),
      JSON.stringify(event),
      { nx: true, ex: WEBHOOK_EVENT_TTL },
    );
    return { inserted: res !== null, event };
  } catch (err) {
    console.error("[kv-store:insertWebhookEvent] Failed (fail-open):", err);
    return { inserted: true, event };
  }
}

/** Fecha o evento gravando `processed_at`. Só depois da lógica de negócio. */
export async function markWebhookEventProcessed(
  paymentId: string,
  changeType: string | number,
): Promise<void> {
  try {
    const chave = chaveEvento(paymentId, changeType);
    const raw = await getRedis().get<string>(chave);
    if (!raw) return;
    const event = (typeof raw === "string" ? JSON.parse(raw) : raw) as WebhookEvent;
    event.processed_at = new Date().toISOString();
    await getRedis().set(chave, JSON.stringify(event), { ex: WEBHOOK_EVENT_TTL });
  } catch (err) {
    console.error("[kv-store:markWebhookEventProcessed] Failed:", err);
  }
}

/**
 * Apaga o registro do evento para que a reentrega do gateway o reprocesse.
 * Chamar só no catch — um evento que falhou no meio não pode ficar bloqueado.
 */
export async function deleteWebhookEvent(
  paymentId: string,
  changeType: string | number,
): Promise<void> {
  try {
    await getRedis().del(chaveEvento(paymentId, changeType));
  } catch (err) {
    console.error("[kv-store:deleteWebhookEvent] Failed:", err);
  }
}

export async function getWebhookEvent(
  paymentId: string,
  changeType: string | number,
): Promise<WebhookEvent | null> {
  try {
    const raw = await getRedis().get<string>(chaveEvento(paymentId, changeType));
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as WebhookEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// payment_index — payment_id ↔ merchant_order_id ↔ draft_id ↔ reservation_id.
//
// Gravado NO MOMENTO DA AUTORIZAÇÃO, não no webhook. O webhook do gateway não
// carrega MerchantOrderId no corpo; com este índice ele resolve a reserva por
// consulta local, sem depender do payload nem de uma ida à API do gateway.
const PAYMENT_INDEX_PREFIX = "payment_index:";
const PAYMENT_INDEX_TTL = 60 * 60 * 24 * 30; // 30 dias

export type PaymentIndex = {
  payment_id: string;
  merchant_order_id: string;
  draft_id: string;
  reservation_id?: number;
  provider: "cielo" | "braspag";
  method: "card" | "pix";
  created_at: string;
};

export async function savePaymentIndex(entry: Omit<PaymentIndex, "created_at">): Promise<void> {
  if (!entry.payment_id) return;
  try {
    const record: PaymentIndex = { ...entry, created_at: new Date().toISOString() };
    await getRedis().set(`${PAYMENT_INDEX_PREFIX}${entry.payment_id}`, JSON.stringify(record), {
      ex: PAYMENT_INDEX_TTL,
    });
  } catch (err) {
    console.error("[kv-store:savePaymentIndex] Failed:", err);
  }
}

export async function getPaymentIndex(paymentId: string): Promise<PaymentIndex | null> {
  const id = (paymentId || "").trim();
  if (!id) return null;
  try {
    const raw = await getRedis().get<string>(`${PAYMENT_INDEX_PREFIX}${id}`);
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as PaymentIndex;
  } catch (err) {
    console.error("[kv-store:getPaymentIndex] Failed:", err);
    return null;
  }
}

/** Completa o índice com o número da reserva assim que ele existe. */
export async function attachReservationToPaymentIndex(
  paymentId: string,
  reservationId: number,
): Promise<void> {
  const existing = await getPaymentIndex(paymentId);
  if (!existing) return;
  try {
    await getRedis().set(
      `${PAYMENT_INDEX_PREFIX}${paymentId}`,
      JSON.stringify({ ...existing, reservation_id: reservationId }),
      { ex: PAYMENT_INDEX_TTL },
    );
  } catch (err) {
    console.error("[kv-store:attachReservationToPaymentIndex] Failed:", err);
  }
}

// ---------------------------------------------------------------------------
// reconciliation_queue — webhook que chegou e NÃO conseguiu identificar a
// reserva. Responder 200 sem registro nenhum é como perder o evento: ninguém
// descobre depois. Cada entrada aqui é uma pendência humana.
const RECONCILE_PREFIX = "reconciliation_pending:";
const RECONCILE_TTL = 60 * 60 * 24 * 90; // 90 dias

export type ReconciliationPending = {
  payment_id: string;
  change_type?: string;
  source: string;
  reason: string;
  payload?: unknown;
  created_at: string;
};

export async function pushReconciliationPending(
  entry: Omit<ReconciliationPending, "created_at">,
): Promise<void> {
  try {
    const record: ReconciliationPending = { ...entry, created_at: new Date().toISOString() };
    await getRedis().set(
      `${RECONCILE_PREFIX}${entry.payment_id || Date.now()}`,
      JSON.stringify(record),
      { ex: RECONCILE_TTL },
    );
  } catch (err) {
    console.error("[kv-store:pushReconciliationPending] Failed:", err);
  }
}

export async function scanReconciliationPending(): Promise<ReconciliationPending[]> {
  try {
    const keys = await scanKeys(`${RECONCILE_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | ReconciliationPending | null)[]>(...keys);
    const out: ReconciliationPending[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(
          typeof raw === "string" ? (JSON.parse(raw) as ReconciliationPending) : (raw as ReconciliationPending),
        );
      } catch {
        // ignora corrompido
      }
    }
    return out;
  } catch (err) {
    console.error("[kv-store:scanReconciliationPending] Failed:", err);
    return [];
  }
}

// Varredura genérica de chaves por padrão (SCAN). Usada por reconcile e authlog.
async function scanKeys(match: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 100 });
    cursor = Number(next);
    keys.push(...batch);
  } while (cursor !== 0);
  return keys;
}

// ---------------------------------------------------------------------------
// Log de autorizações Braspag persistido no KV (diagnóstico sem depender dos
// logs da Vercel). Chave braspag:authlog:<ts>-<rand>, TTL 7 dias, máx 20 (os
// mais antigos são removidos). NUNCA gravar PAN/CVV/validade — só BIN/últimos 4.
const AUTHLOG_PREFIX = "braspag:authlog:";
const AUTHLOG_TTL = 60 * 60 * 24 * 7; // 7 dias
// Elevado para o lançamento com a flag ligada: com tráfego real, 20 entradas
// rotacionam em horas e uma recusa some antes de alguém investigar.
const AUTHLOG_MAX = 200;

export async function pushAuthLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const redis = getRedis();
    const ts = Date.now();
    const key = `${AUTHLOG_PREFIX}${ts}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.set(key, JSON.stringify({ ...entry, _ts: ts }), { ex: AUTHLOG_TTL });
    // Cap: mantém no máximo AUTHLOG_MAX (remove os mais antigos). O timestamp no
    // prefixo tem largura fixa (13 dígitos) → sort de string = ordem cronológica.
    const keys = await scanKeys(`${AUTHLOG_PREFIX}*`);
    if (keys.length > AUTHLOG_MAX) {
      const oldest = keys.sort().slice(0, keys.length - AUTHLOG_MAX);
      if (oldest.length) await redis.del(...oldest);
    }
  } catch (err) {
    console.error("[kv-store:pushAuthLog] Failed:", err);
  }
}

export async function readAuthLog(): Promise<Record<string, unknown>[]> {
  try {
    const redis = getRedis();
    const keys = await scanKeys(`${AUTHLOG_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget<(string | Record<string, unknown> | null)[]>(...keys);
    const entries: Record<string, unknown>[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        entries.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>));
      } catch {
        // ignora entrada corrompida
      }
    }
    // Mais recente primeiro.
    return entries.sort((a, b) => Number(b._ts ?? 0) - Number(a._ts ?? 0));
  } catch (err) {
    console.error("[kv-store:readAuthLog] Failed:", err);
    return [];
  }
}

export async function updateDraft(id: string, updates: Partial<ReservationDraft>): Promise<void> {
  try {
    const existing = await getDraft(id);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    await getRedis().set(`draft:${id}`, JSON.stringify(updated), { ex: DRAFT_TTL });
  } catch (err) {
    console.error("[kv-store:updateDraft] Failed:", err);
    throw err;
  }
}


/**
 * Recupera o `draftId` a partir do `MerchantOrderId` enviado ao gateway.
 *
 * Cada TENTATIVA de pagamento leva um MerchantOrderId novo (`<draftId>-<sufixo>`)
 * para que três cartões no mesmo draft não cheguem à Braspag com o mesmo número
 * de pedido. Os webhooks continuam precisando do draft, então desfazem o sufixo
 * aqui. Formatos antigos, sem sufixo, seguem funcionando.
 */
export function draftIdDeOrderId(orderId: string): string {
  const i = (orderId || "").lastIndexOf("-");
  if (i <= 0) return orderId;
  // UUID do draft tem 36 caracteres; o sufixo de tentativa vem depois dele.
  return orderId.length > 36 ? orderId.slice(0, 36) : orderId;
}

// ---------------------------------------------------------------------------
// csp_violations — relatórios de violação da CSP da rota de pagamento.
//
// Enquanto a política roda em Report-Only, cada entrada aqui é um domínio que
// SERIA bloqueado. É a lista de origens legítimas que faltam na política — a
// fonte para completá-la antes de promover a bloqueio.
//
// Deduplicado por (blocked_uri, violated_directive): uma campanha com tráfego
// gera milhares de relatórios idênticos, e o que interessa é o conjunto de
// origens distintas mais a contagem.
const CSP_PREFIX = "csp_violations:";
const CSP_TTL = 60 * 60 * 24 * 90; // 90 dias

export type CspViolation = {
  blocked_uri: string;
  violated_directive: string;
  document_uri: string;
  user_agent: string;
  occurred_at: string;
  /** Quantas vezes esta combinação já chegou. */
  count: number;
  first_seen: string;
  last_seen: string;
};

/** Chave estável e curta para o par (origem bloqueada, diretiva). */
function chaveViolacao(blockedUri: string, directive: string): string {
  const bruto = `${blockedUri}|${directive}`;
  let hash = 0;
  for (let i = 0; i < bruto.length; i++) {
    hash = (hash * 31 + bruto.charCodeAt(i)) | 0;
  }
  return `${CSP_PREFIX}${(hash >>> 0).toString(36)}`;
}

export async function recordCspViolation(v: {
  blocked_uri: string;
  violated_directive: string;
  document_uri: string;
  user_agent: string;
}): Promise<void> {
  try {
    const redis = getRedis();
    const chave = chaveViolacao(v.blocked_uri, v.violated_directive);
    const agora = new Date().toISOString();
    const bruto = await redis.get<string>(chave);
    const existente = bruto
      ? ((typeof bruto === "string" ? JSON.parse(bruto) : bruto) as CspViolation)
      : null;

    const registro: CspViolation = existente
      ? { ...existente, count: existente.count + 1, last_seen: agora, occurred_at: agora }
      : {
          ...v,
          occurred_at: agora,
          count: 1,
          first_seen: agora,
          last_seen: agora,
        };
    await redis.set(chave, JSON.stringify(registro), { ex: CSP_TTL });
  } catch (err) {
    console.error("[kv-store:recordCspViolation] Failed:", err);
  }
}

export async function scanCspViolations(): Promise<CspViolation[]> {
  try {
    const keys = await scanKeys(`${CSP_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | CspViolation | null)[]>(...keys);
    const out: CspViolation[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(typeof raw === "string" ? (JSON.parse(raw) as CspViolation) : (raw as CspViolation));
      } catch {
        // ignora corrompido
      }
    }
    return out.sort((a, b) => b.count - a.count);
  } catch (err) {
    console.error("[kv-store:scanCspViolations] Failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// conversions_sent — par (transaction_id, destino) já enviado.
//
// TTL de 24 meses, deliberadamente MUITO acima dos 30 dias de webhook_events.
// A guarda do webhook cobre a reentrega dentro da janela dele; este registro é
// o que impede uma reentrega tardia, ou um reprocessamento manual, de contar a
// mesma reserva duas vezes no GA4 e no Meta.
const CONVERSION_PREFIX = "conversions_sent:";
const CONVERSION_TTL = 60 * 60 * 24 * 730; // 24 meses

/** De onde partiu o envio. Responde "qual caminho criou esta reserva?". */
export type RotaOrigemConversao =
  | "braspag"
  | "cielo"
  | "pix"
  | "webhook"
  | "recuperacao-manual";

export type ConversionSent = {
  transaction_id: string;
  destino: "ga4" | "meta";
  sent_at: string;
  http_status: number | null;
  /** `pulado_sem_credencial` também é registrado: a ausência é um desfecho. */
  resultado?: "ok" | "falha" | "pulado_sem_credencial";
  /**
   * Veredito de `/debug/mp/collect`. O 204 do envio real não distingue evento
   * contabilizado de descartado — só esta validação responde.
   */
  validacao_ga4?: { ok: boolean; mensagens?: string[] };
  rota_origem?: RotaOrigemConversao;
  provider?: string;
};

function chaveConversao(transactionId: string, destino: "ga4" | "meta"): string {
  return `${CONVERSION_PREFIX}${destino}:${transactionId}`;
}

/** true = já enviado antes; o chamador deve pular. */
export async function conversionAlreadySent(
  transactionId: string,
  destino: "ga4" | "meta",
): Promise<boolean> {
  if (!transactionId) return false;
  try {
    const raw = await getRedis().get<string>(chaveConversao(transactionId, destino));
    return Boolean(raw);
  } catch (err) {
    // Fail-open: perder uma conversão é pior que contar duas. O `event_id`
    // igual em GA4 e Meta ainda permite a deduplicação do lado deles.
    console.error("[kv-store:conversionAlreadySent] Failed (fail-open):", err);
    return false;
  }
}

export async function markConversionSent(entry: {
  transactionId: string;
  destino: "ga4" | "meta";
  httpStatus: number | null;
  resultado?: "ok" | "falha" | "pulado_sem_credencial";
  validacaoGa4?: { ok: boolean; mensagens?: string[] };
  rotaOrigem?: RotaOrigemConversao;
  provider?: string;
}): Promise<void> {
  if (!entry.transactionId) return;
  try {
    const registro: ConversionSent = {
      transaction_id: entry.transactionId,
      destino: entry.destino,
      sent_at: new Date().toISOString(),
      http_status: entry.httpStatus,
      resultado: entry.resultado,
      validacao_ga4: entry.validacaoGa4,
      rota_origem: entry.rotaOrigem,
      provider: entry.provider,
    };
    await getRedis().set(
      chaveConversao(entry.transactionId, entry.destino),
      JSON.stringify(registro),
      { ex: CONVERSION_TTL },
    );
  } catch (err) {
    console.error("[kv-store:markConversionSent] Failed:", err);
  }
}

/**
 * Registros de conversão, mais recentes primeiro.
 *
 * Base da pergunta "a venda de ontem foi contabilizada?", respondida sem abrir
 * o painel do Google nem o do Meta.
 */
export async function scanConversoesEnviadas(limite = 50): Promise<ConversionSent[]> {
  try {
    const keys = await scanKeys(`${CONVERSION_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | ConversionSent | null)[]>(...keys);
    const out: ConversionSent[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(typeof raw === "string" ? (JSON.parse(raw) as ConversionSent) : (raw as ConversionSent));
      } catch {
        // ignora corrompido
      }
    }
    return out.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)).slice(0, limite);
  } catch (err) {
    console.error("[kv-store:scanConversoesEnviadas] Failed:", err);
    return [];
  }
}

/** Os dois registros (GA4 e Meta) de uma reserva específica. */
export async function lerConversoesDaReserva(transactionId: string): Promise<ConversionSent[]> {
  const out: ConversionSent[] = [];
  for (const destino of ["ga4", "meta"] as const) {
    try {
      const raw = await getRedis().get<string>(chaveConversao(transactionId, destino));
      if (!raw) continue;
      out.push((typeof raw === "string" ? JSON.parse(raw) : raw) as ConversionSent);
    } catch {
      // ignora
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// hostaway_pending_finalization — fila de marcação de pagamento na Hostaway.
//
// A Hostaway tem lag entre aceitar a criação da reserva e aceitar uma cobrança
// nela. Tentar marcar na hora falha na maior parte das vezes, e segurar a
// resposta esperando o lag passar é pior: o cliente fica na tela de pagamento.
// Enfileirar desacopla as duas coisas — a reserva nasce e a marcação vira
// trabalho de fundo, com retry.
//
// Chave por reservation_id: enfileirar duas vezes a mesma reserva não cria duas
// entradas, então uma reentrega de webhook não vira cobrança duplicada.
const FINALIZACAO_PREFIX = "hostaway_pending_finalization:";
const FINALIZACAO_TTL = 60 * 60 * 24 * 30; // 30 dias

/** Espaçamento entre tentativas, em minutos. Depois da última, escala. */
export const BACKOFF_FINALIZACAO_MIN = [5, 15, 30, 60, 60, 60];
export const MAX_TENTATIVAS_FINALIZACAO = BACKOFF_FINALIZACAO_MIN.length;

export type FinalizacaoHostaway = {
  reservation_id: number;
  /** Cartão entra como cobrança offline; Pix, como transferência. */
  payment_method: "credit_card_offline" | "bank_transfer";
  amount: number;
  currency: string;
  draft_id?: string;
  attempts: number;
  created_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  /** Esgotou as tentativas: sai da rotação e aparece no diagnóstico. */
  escalado?: boolean;
};

function chaveFinalizacao(reservationId: number | string): string {
  return `${FINALIZACAO_PREFIX}${reservationId}`;
}

/**
 * Põe a reserva na fila. Idempotente por `reservation_id` — chamar de novo para
 * a mesma reserva não reinicia o contador nem duplica a entrada.
 */
export async function enfileirarFinalizacaoHostaway(entrada: {
  reservation_id: number;
  payment_method: "credit_card_offline" | "bank_transfer";
  amount: number;
  currency?: string;
  draft_id?: string;
}): Promise<void> {
  if (!entrada.reservation_id || entrada.reservation_id <= 0) return;
  try {
    const chave = chaveFinalizacao(entrada.reservation_id);
    const existente = await getRedis().get<string>(chave);
    if (existente) {
      console.log(`[Hostaway:fila] já enfileirada reservation_id=${entrada.reservation_id}`);
      return;
    }
    const registro: FinalizacaoHostaway = {
      reservation_id: entrada.reservation_id,
      payment_method: entrada.payment_method,
      amount: entrada.amount,
      currency: entrada.currency || "BRL",
      draft_id: entrada.draft_id,
      attempts: 0,
      created_at: new Date().toISOString(),
      last_attempt_at: null,
      last_error: null,
    };
    await getRedis().set(chave, JSON.stringify(registro), { ex: FINALIZACAO_TTL });
    console.log(
      `[Hostaway:fila] enfileirada reservation_id=${entrada.reservation_id} ` +
        `metodo=${entrada.payment_method} valor=${entrada.amount}`,
    );
  } catch (err) {
    // Nunca derruba a reserva: ela já existe e o pagamento já foi capturado.
    console.error("[kv-store:enfileirarFinalizacaoHostaway] Failed:", err);
  }
}

export async function scanFinalizacoesHostaway(): Promise<FinalizacaoHostaway[]> {
  try {
    const keys = await scanKeys(`${FINALIZACAO_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await getRedis().mget<(string | FinalizacaoHostaway | null)[]>(...keys);
    const out: FinalizacaoHostaway[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        out.push(
          typeof raw === "string" ? (JSON.parse(raw) as FinalizacaoHostaway) : (raw as FinalizacaoHostaway),
        );
      } catch {
        // ignora corrompido
      }
    }
    return out;
  } catch (err) {
    console.error("[kv-store:scanFinalizacoesHostaway] Failed:", err);
    return [];
  }
}

/** Sucesso: sai da fila de vez. */
export async function removerFinalizacaoHostaway(reservationId: number): Promise<void> {
  try {
    await getRedis().del(chaveFinalizacao(reservationId));
  } catch (err) {
    console.error("[kv-store:removerFinalizacaoHostaway] Failed:", err);
  }
}

/** Falha: incrementa a tentativa e guarda o erro; escala ao esgotar. */
export async function registrarFalhaFinalizacao(
  reservationId: number,
  erro: string,
): Promise<FinalizacaoHostaway | null> {
  try {
    const chave = chaveFinalizacao(reservationId);
    const raw = await getRedis().get<string>(chave);
    if (!raw) return null;
    const registro = (typeof raw === "string" ? JSON.parse(raw) : raw) as FinalizacaoHostaway;
    registro.attempts += 1;
    registro.last_attempt_at = new Date().toISOString();
    registro.last_error = erro.slice(0, 400);
    if (registro.attempts >= MAX_TENTATIVAS_FINALIZACAO) {
      registro.escalado = true;
      console.error(
        `[Hostaway:fila] ESCALADO reservation_id=${reservationId} após ${registro.attempts} tentativas: ${registro.last_error}`,
      );
    }
    await getRedis().set(chave, JSON.stringify(registro), { ex: FINALIZACAO_TTL });
    return registro;
  } catch (err) {
    console.error("[kv-store:registrarFalhaFinalizacao] Failed:", err);
    return null;
  }
}

/**
 * A entrada está madura para nova tentativa?
 *
 * Backoff pelo número de tentativas já feitas. Escalada sai da rotação — quem
 * resolve é uma pessoa, olhando o diagnóstico.
 */
export function podeTentarFinalizacao(r: FinalizacaoHostaway, agora = Date.now()): boolean {
  if (r.escalado) return false;
  if (r.attempts >= MAX_TENTATIVAS_FINALIZACAO) return false;
  if (!r.last_attempt_at) {
    // Primeira tentativa: espera a janela inicial passar desde a criação, para
    // dar tempo de a Hostaway registrar a reserva.
    const desde = Date.parse(r.created_at);
    if (!Number.isFinite(desde)) return true;
    return agora - desde >= BACKOFF_FINALIZACAO_MIN[0] * 60_000;
  }
  const ultima = Date.parse(r.last_attempt_at);
  if (!Number.isFinite(ultima)) return true;
  const esperaMin = BACKOFF_FINALIZACAO_MIN[Math.min(r.attempts, BACKOFF_FINALIZACAO_MIN.length - 1)];
  return agora - ultima >= esperaMin * 60_000;
}
