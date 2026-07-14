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
  status: "pending" | "paid" | "failed";
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
