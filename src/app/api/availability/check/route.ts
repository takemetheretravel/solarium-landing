import { NextResponse } from "next/server";
import { getCalendar } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";

export const runtime = "nodejs";

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function nightsBetween(checkin: string, checkout: string): string[] {
  const result: string[] = [];
  const cur = new Date(checkin + "T12:00:00");
  const end = new Date(checkout + "T12:00:00");
  while (cur < end) {
    result.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const { propertyId, checkin, checkout, guests } = (await req.json()) as {
      propertyId?: string;
      checkin?: string;
      checkout?: string;
      guests?: number;
    };

    if (!propertyId || !checkin || !checkout) {
      return NextResponse.json({ available: false, reason: "Datas e propriedade são obrigatórias." });
    }
    if (checkin >= checkout) {
      return NextResponse.json({ available: false, reason: "Check-out deve ser depois do check-in." });
    }

    const property = getPropertyBySlug(propertyId);
    if (!property) {
      return NextResponse.json({ available: false, reason: "Propriedade não encontrada." });
    }
    if (guests && guests > property.capacity.max) {
      return NextResponse.json({
        available: false,
        reason: `Esta casa acomoda no máximo ${property.capacity.max} hóspedes.`,
      });
    }

    const raw = await getCalendar(property.id, checkin, checkout);
    if (!raw || raw.length === 0) {
      return NextResponse.json({
        available: false,
        reason: "Não foi possível verificar a disponibilidade. Fale com nosso concierge.",
      });
    }

    // Index by date
    const dayMap = new Map(raw.map((d) => [d.date, d]));

    // 1. Check-in day must not be closedOnArrival
    const checkinDay = dayMap.get(checkin);
    if (!checkinDay) {
      return NextResponse.json({ available: false, reason: "Não foi possível verificar a data de check-in." });
    }
    if (checkinDay.closedOnArrival === 1) {
      return NextResponse.json({
        available: false,
        reason: `Check-in em ${fmtBR(checkin)} não está disponível. Tente outra data.`,
      });
    }

    // 2. All nights between checkin and checkout must be available
    for (const iso of nightsBetween(checkin, checkout)) {
      const day = dayMap.get(iso);
      if (!day || day.isAvailable !== 1) {
        return NextResponse.json({
          available: false,
          reason: `${fmtBR(iso)} não está disponível neste período.`,
        });
      }
    }

    // 3. Minimum stay
    const minStay = checkinDay.minimumStay || 1;
    const nights = Math.round(
      (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (nights < minStay) {
      return NextResponse.json({
        available: false,
        reason: `Esta data exige mínimo de ${minStay} noite${minStay > 1 ? "s" : ""}.`,
      });
    }

    // 4. Checkout day must not be closedOnDeparture
    const checkoutDay = dayMap.get(checkout);
    if (checkoutDay && checkoutDay.closedOnDeparture === 1) {
      return NextResponse.json({
        available: false,
        reason: `Check-out em ${fmtBR(checkout)} não está disponível. Tente outra data.`,
      });
    }

    return NextResponse.json({ available: true });
  } catch (err) {
    console.error("[availability/check]", err);
    return NextResponse.json({
      available: false,
      reason: "Erro ao verificar disponibilidade. Fale com nosso concierge.",
    });
  }
}
