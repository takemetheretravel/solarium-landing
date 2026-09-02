import { NextRequest, NextResponse } from "next/server";
import { calculatePriceDetailed, getCalendar } from "@/lib/hostaway";
import { getPropertyById } from "@/config/properties";
import { exigirAdminForaDeProducao } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Era `?key=lucas2026`, com a chave escrita neste arquivo, em repo público.
  const negado = exigirAdminForaDeProducao(req);
  if (negado) return negado;

  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get("propertyId"));
  const checkin = sp.get("checkin") || "";
  const checkout = sp.get("checkout") || "";
  const guests = Number(sp.get("guests") || 2);

  const property = getPropertyById(id);
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const t0 = Date.now();
  const result = await calculatePriceDetailed(id, checkin, checkout, guests);
  const elapsed = Date.now() - t0;

  // Also fetch raw calendar for inspection
  const lastNight = (() => {
    const d = new Date(checkout + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const days = await getCalendar(id, checkin, lastNight);

  return NextResponse.json({
    propertyId: id,
    propertyName: property.name,
    checkin,
    checkout,
    guests,
    elapsedMs: elapsed,
    approach: "calendar-sum (POST /calendarPriceCalculator → 404 em produção)",
    result,
    rawDays: days,
  });
}
