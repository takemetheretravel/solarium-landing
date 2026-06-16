import { blockCalendarNight } from "@/lib/hostaway";
import { listingsForProperty } from "@/config/operational-extras";

export type OpExtraEmail = { label: string; blockedNight: string; blockFailed?: boolean };

/**
 * Bloqueia as noites adjacentes de cada extra operacional em TODAS as listings
 * físicas da casa (Completo = as duas casas). Best-effort: a reserva nunca falha
 * por causa disto — o hostNote já registra a noite como garantia. Retorna a lista
 * para o email, marcando o que falhou para acionamento manual.
 */
export async function blockOpExtraNights(
  propertySlug: string,
  opExtras?: { type: string; label: string; price: number; blockedNight: string }[],
): Promise<OpExtraEmail[] | undefined> {
  if (!opExtras?.length) return undefined;
  const listings = listingsForProperty(propertySlug);
  const out: OpExtraEmail[] = [];
  for (const op of opExtras) {
    let blockFailed = false;
    for (const lid of listings) {
      const ok = await blockCalendarNight(lid, op.blockedNight);
      if (!ok) {
        blockFailed = true;
        console.error(`[Hostaway:block] FALHA — bloquear manualmente ${op.blockedNight} (listing ${lid})`);
      }
    }
    out.push({ label: op.label, blockedNight: op.blockedNight, blockFailed });
  }
  return out;
}
