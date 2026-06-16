import { getPropertyBySlug } from "@/config/properties";

export type OpExtraType = "early_checkin" | "late_checkout";

export const OP_EXTRA_TYPES: OpExtraType[] = ["early_checkin", "late_checkout"];

const PRICING: Record<string, { fds: number; semana: number }> = {
  "solarium-1": { fds: 850, semana: 550 },
  "solarium-2": { fds: 850, semana: 550 },
  "solarium-completo": { fds: 1600, semana: 1000 },
};

export const OP_EXTRA_LABELS: Record<OpExtraType, string> = {
  early_checkin: "Check-in antecipado (a partir das 9h)",
  late_checkout: "Check-out estendido (até as 18h)",
};

// Instrução interna p/ concierge (hostNote)
export const OP_EXTRA_NOTES: Record<OpExtraType, string> = {
  early_checkin: "Liberar entrada a partir das 9h — noite anterior bloqueada para preparo",
  late_checkout: "Permitir saída até as 18h — noite do checkout bloqueada para preparo",
};

// Noite que precisa ser bloqueada (ISO)
export function blockedNightFor(type: OpExtraType, checkin: string, checkout: string): string {
  if (type === "early_checkin") {
    const d = new Date(checkin + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return checkout; // late_checkout bloqueia a noite do próprio checkout
}

// Preço cobrado + âncora riscada (visual). Regra pela noite bloqueada:
//  sex(5)/sáb(6) → fds cheio, sem âncora
//  dom(0)        → cobra semana, mas mostra fds riscado (corte de preço)
//  seg-qui       → semana, sem âncora
export function opExtraPricing(
  propertySlug: string,
  type: OpExtraType,
  checkin: string,
  checkout: string,
): { price: number; anchor: number | null } {
  const table = PRICING[propertySlug];
  if (!table) return { price: 0, anchor: null };
  const night = blockedNightFor(type, checkin, checkout);
  const dow = new Date(night + "T12:00:00").getDay();
  if (dow === 5 || dow === 6) return { price: table.fds, anchor: null };
  if (dow === 0) return { price: table.semana, anchor: table.fds };
  return { price: table.semana, anchor: null };
}

// Preço cobrado (usado no recálculo server-side). A âncora é puramente visual.
export function opExtraPrice(propertySlug: string, type: OpExtraType, checkin: string, checkout: string): number {
  return opExtraPricing(propertySlug, type, checkin, checkout).price;
}

// Listings físicas a verificar/bloquear para cada casa.
// Solarium Completo = as DUAS casas físicas (316007 + 316005); reserva em qualquer
// uma ocupa o conjunto, então checamos e bloqueamos ambas.
export function listingsForProperty(propertySlug: string): number[] {
  if (propertySlug === "solarium-completo") {
    const ids = [getPropertyBySlug("solarium-1")?.id, getPropertyBySlug("solarium-2")?.id];
    return ids.filter((id): id is number => typeof id === "number");
  }
  const p = getPropertyBySlug(propertySlug);
  return p ? [p.id] : [];
}
