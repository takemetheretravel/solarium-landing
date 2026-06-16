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

// Aviso fino ao cliente (restrição) na linha do extra
export const OP_EXTRA_CLIENT_HINT: Record<OpExtraType, string> = {
  early_checkin: "Sujeito à noite anterior livre — reservamos a casa na véspera.",
  late_checkout: "Sujeito à noite do check-out livre — reservamos a casa no dia da saída.",
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

// fds = noite bloqueada cai em sexta(5) ou sábado(6)
export function opExtraPrice(propertySlug: string, type: OpExtraType, checkin: string, checkout: string): number {
  const table = PRICING[propertySlug];
  if (!table) return 0;
  const night = blockedNightFor(type, checkin, checkout);
  const dow = new Date(night + "T12:00:00").getDay();
  return dow === 5 || dow === 6 ? table.fds : table.semana;
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
