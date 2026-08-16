import { blockCalendarNight } from "@/lib/hostaway";
import { listingsForProperty, OP_EXTRA_LABELS, type OpExtraType } from "@/config/operational-extras";
import { noiteBloqueada } from "@/lib/pricing/extras";
import type { ReservationDraft } from "@/lib/kv-store";

export type OpExtraEmail = { label: string; blockedNight: string; blockFailed?: boolean };

const TIPOS_OPERACIONAIS: OpExtraType[] = ["early_checkin", "late_checkout"];

/**
 * Noites que precisam ser bloqueadas nesta reserva, venham de onde vierem.
 *
 * Duas origens, um destino só:
 *  - `opExtras`: item operacional contratado à parte, no fluxo avulso;
 *  - `pacoteItens`: early/late que o PACOTE já traz incluso.
 *
 * O segundo caso não existia aqui, e por isso o late incluso não bloqueava nada:
 * o check-in do listing é às 15h e o hóspede fica até as 18h, então dava para
 * aceitar reserva nova com ele ainda na casa.
 */
export function noitesABloquear(draft: ReservationDraft): { label: string; blockedNight: string }[] {
  const noites = new Map<string, string>(); // noite -> label

  for (const op of draft.opExtras ?? []) {
    noites.set(op.blockedNight, op.label);
  }

  for (const item of draft.pacoteItens ?? []) {
    if (!TIPOS_OPERACIONAIS.includes(item.extraId as OpExtraType)) continue;
    if (item.qtd <= 0) continue;
    const noite = noiteBloqueada(item.extraId as OpExtraType, draft.checkin, draft.checkout);
    // O rótulo do avulso quando houver; senão o nome que o pacote exibe.
    noites.set(noite, OP_EXTRA_LABELS[item.extraId as OpExtraType] ?? item.nome);
  }

  return Array.from(noites.entries()).map(([blockedNight, label]) => ({ label, blockedNight }));
}

/**
 * Bloqueia as noites em TODAS as listings físicas da casa (Completo = as duas).
 *
 * NÃO é best-effort: quem chama precisa checar `todasBloqueadas` antes de criar a
 * reserva. Deixar passar em silêncio é aceitar overbooking com o hóspede dentro
 * da casa.
 */
export async function blockOpExtraNights(
  propertySlug: string,
  draft: ReservationDraft,
): Promise<{ resultados: OpExtraEmail[] | undefined; todasBloqueadas: boolean }> {
  const alvo = noitesABloquear(draft);
  if (alvo.length === 0) return { resultados: undefined, todasBloqueadas: true };

  const listings = listingsForProperty(propertySlug);
  const out: OpExtraEmail[] = [];
  let todasBloqueadas = true;

  for (const item of alvo) {
    let blockFailed = false;
    for (const lid of listings) {
      const ok = await blockCalendarNight(lid, item.blockedNight);
      if (!ok) {
        blockFailed = true;
        todasBloqueadas = false;
        console.error(
          `[Hostaway:block] FALHA — bloquear manualmente ${item.blockedNight} (listing ${lid})`,
        );
      }
    }
    out.push({ label: item.label, blockedNight: item.blockedNight, blockFailed });
  }

  return { resultados: out, todasBloqueadas };
}
