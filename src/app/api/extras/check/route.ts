import { NextResponse } from "next/server";
import { getPropertyBySlug } from "@/config/properties";
import { getCalendar } from "@/lib/hostaway";
import {
  OpExtraType,
  OP_EXTRA_TYPES,
  OP_EXTRA_LABELS,
  blockedNightFor,
  opExtraPricing,
  listingsForProperty,
} from "@/config/operational-extras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  propertyId?: string;
  checkin?: string;
  checkout?: string;
  types?: string[];
};

// Disponível = em TODAS as listings da casa, a noite alvo retorna ao menos uma
// linha e TODAS as linhas daquela data têm isAvailable===1.
// (Algumas listings retornam mais de uma linha por data — unidades múltiplas.)
async function nightIsFree(listings: number[], night: string): Promise<boolean> {
  if (listings.length === 0) return false;
  const checks = await Promise.all(
    listings.map(async (id) => {
      const days = await getCalendar(id, night, night);
      return days.length > 0 && days.every((d) => d.isAvailable === 1);
    }),
  );
  return checks.every(Boolean);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const property = body.propertyId ? getPropertyBySlug(body.propertyId) : undefined;
  if (!property || !body.checkin || !body.checkout) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  const checkin = body.checkin;
  const checkout = body.checkout;
  const types = (body.types ?? []).filter((t): t is OpExtraType =>
    OP_EXTRA_TYPES.includes(t as OpExtraType),
  );
  const listings = listingsForProperty(property.slug);

  const results = await Promise.all(
    types.map(async (type) => {
      const night = blockedNightFor(type, checkin, checkout);
      const available = await nightIsFree(listings, night);
      const { price, anchor } = opExtraPricing(property.slug, type, checkin, checkout);
      return {
        type,
        available,
        price,
        anchor,
        blockedNight: night,
        label: OP_EXTRA_LABELS[type],
      };
    }),
  );

  return NextResponse.json({ results });
}
