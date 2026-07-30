import { SITE } from "@/config/site";
import type { ReservationDraft } from "@/lib/kv-store";

// Extras de serviço + operacionais NÃO recebem desconto de Pix (mesma regra da
// criação do draft).
function extrasSumReais(draft: ReservationDraft): number {
  const s = (draft.serviceExtras ?? []).reduce((a, e) => a + e.price, 0);
  const o = (draft.opExtras ?? []).reduce((a, e) => a + e.price, 0);
  return s + o;
}

// Cobrança Pix a partir do draft — fonte ÚNICA do percentual (SITE.pixDiscountPercent).
// - IDEMPOTENTE: se o draft já teve o desconto aplicado (pixDiscount > 0), reverte
//   antes de reaplicar, para nunca descontar em dobro.
// - PRECISÃO DE CENTAVOS: a criação do draft arredonda o desconto a reais inteiros
//   (Math.round(base*0.03)), o que ZERA o desconto em valores pequenos (ex.: 3% de
//   R$10 = R$0,30 → 0). Aqui calculamos em centavos, então o desconto real aparece.
export function pixChargeFromDraft(draft: ReservationDraft): {
  subtotalCents: number; // total antes do desconto Pix (base descontável + extras)
  discountCents: number; // desconto Pix (só sobre a base; extras não entram)
  totalCents: number; // valor final a cobrar
} {
  const extras = extrasSumReais(draft);
  const alreadyApplied = draft.pixDiscount || 0;
  // Base descontável (estadia + cupom), sem extras e sem o desconto já aplicado.
  const baseReais = draft.finalTotal - extras + alreadyApplied;
  const baseCents = Math.max(0, Math.round(baseReais * 100));
  const extrasCents = Math.max(0, Math.round(extras * 100));
  const discountCents = Math.round((baseCents * SITE.pixDiscountPercent) / 100);
  const totalCents = baseCents - discountCents + extrasCents;
  return { subtotalCents: baseCents + extrasCents, discountCents, totalCents };
}
