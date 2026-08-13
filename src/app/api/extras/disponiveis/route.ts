import { NextRequest, NextResponse } from "next/server";
import { getPropertyBySlug } from "@/config/properties";
import { pacotesV2Ativo } from "@/config/flags";
import { extrasExibiveis, noiteBloqueada } from "@/lib/pricing/extras";
import { listingsForProperty } from "@/config/operational-extras";
import { getCalendar } from "@/lib/hostaway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extras que podem ser oferecidos para uma casa e um período, já filtrados por
 * noite adjacente livre e antecedência mínima.
 *
 * Usado pela página da casa e pelo checkout. Nunca exibir um extra aqui e
 * recusá-lo depois no draft — por isso o filtro roda no servidor, contra o
 * calendário real.
 */
export async function GET(req: NextRequest) {
  if (!pacotesV2Ativo()) {
    return NextResponse.json({ error: "indisponível" }, { status: 404 });
  }

  const sp = new URL(req.url).searchParams;
  const property = getPropertyBySlug(sp.get("property") || "");
  const checkin = sp.get("checkin") || "";
  const checkout = sp.get("checkout") || "";

  if (!property || !checkin || !checkout) {
    return NextResponse.json({ error: "Parâmetros incompletos." }, { status: 400 });
  }

  const listings = listingsForProperty(property.slug);
  const livre = async (noite: string) => {
    if (listings.length === 0) return false;
    const checks = await Promise.all(
      listings.map(async (id) => {
        const dias = await getCalendar(id, noite, noite);
        return dias.length > 0 && dias.every((d) => d.isAvailable === 1);
      }),
    );
    return checks.every(Boolean);
  };

  const [early, late] = await Promise.all([
    livre(noiteBloqueada("early_checkin", checkin, checkout)),
    livre(noiteBloqueada("late_checkout", checkin, checkout)),
  ]);

  const disponiveis = extrasExibiveis(property.slug, {
    checkin,
    checkout,
    hoje: new Date().toISOString().slice(0, 10),
    noitesLivres: { early_checkin: early, late_checkout: late },
  });

  return NextResponse.json({ disponiveis });
}
