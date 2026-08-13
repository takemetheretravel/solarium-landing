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
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCpf: string;
  guestNotes?: string;
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
// Deduplicação de eventos de webhook (a mesma notificação chega/reprocessa 2x).
// claimWebhookEventOnce: atômico via SET NX. Retorna true se é a PRIMEIRA vez
// (deve processar); false se já visto na janela de TTL (ignorar). Em falha de
// Redis, "fail-open" (retorna true) — melhor processar que perder um pagamento.
// releaseWebhookEvent: libera a claim (chamar no catch, p/ o retry reprocessar).
const WEBHOOK_SEEN_PREFIX = "braspag:webhook-seen:";
export async function claimWebhookEventOnce(key: string, ttlSeconds = 600): Promise<boolean> {
  try {
    const res = await getRedis().set(`${WEBHOOK_SEEN_PREFIX}${key}`, "1", { nx: true, ex: ttlSeconds });
    return res !== null; // "OK" quando setou (novo); null quando já existia
  } catch (err) {
    console.error("[kv-store:claimWebhookEventOnce] Failed (fail-open):", err);
    return true;
  }
}
export async function releaseWebhookEvent(key: string): Promise<void> {
  try {
    await getRedis().del(`${WEBHOOK_SEEN_PREFIX}${key}`);
  } catch (err) {
    console.error("[kv-store:releaseWebhookEvent] Failed:", err);
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
const AUTHLOG_MAX = 20;

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
