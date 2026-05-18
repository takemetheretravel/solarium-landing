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
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string;
  guestCpf: string;
  guestNotes?: string;
  status: "pending" | "paid" | "failed";
  cieloPaymentId?: string;
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
