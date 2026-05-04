import { randomUUID } from "crypto";

export type ReservationDraft = {
  id: string;
  createdAt: number;
  expiresAt: number;
  propertyId: number;
  propertySlug: string;
  propertyName: string;
  checkin: string;
  checkout: string;
  guests: number;
  paymentMethod: "card" | "pix";
  couponCode?: string;
  totals: {
    nights: number;
    subtotal: number;
    cleaningFee: number;
    discount: number;
    couponDiscount: number;
    pixDiscount: number;
    total: number;
  };
  guest: {
    name: string;
    email: string;
    cpf: string;
    phone: string;
    notes?: string;
  };
};

const TTL_MS = 30 * 60 * 1000;

const globalAny = globalThis as unknown as {
  __solariumReservations?: Map<string, ReservationDraft>;
};

function store(): Map<string, ReservationDraft> {
  if (!globalAny.__solariumReservations) {
    globalAny.__solariumReservations = new Map();
  }
  return globalAny.__solariumReservations;
}

function purgeExpired(): void {
  const now = Date.now();
  const s = store();
  Array.from(s.entries()).forEach(([id, draft]) => {
    if (draft.expiresAt < now) s.delete(id);
  });
}

export function createDraft(
  data: Omit<ReservationDraft, "id" | "createdAt" | "expiresAt">,
): ReservationDraft {
  purgeExpired();
  const now = Date.now();
  const draft: ReservationDraft = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  store().set(draft.id, draft);
  return draft;
}

export function getDraft(id: string): ReservationDraft | undefined {
  purgeExpired();
  return store().get(id);
}
