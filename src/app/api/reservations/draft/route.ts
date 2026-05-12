import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveDraft, getDraft } from "@/lib/kv-store";
import { calculatePrice } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { validateCoupon } from "@/config/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  propertySlug: string;
  checkin: string;
  checkout: string;
  guests: number;
  paymentMethod?: "card" | "pix";
  couponCode?: string;
  guest: {
    name: string;
    email: string;
    cpf: string;
    phone: string;
    notes?: string;
  };
};

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function validCPF(raw: string): boolean {
  const cpf = digitsOnly(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (slice: number) => {
    let sum = 0;
    for (let i = 0; i < slice; i++) {
      sum += parseInt(cpf.charAt(i)) * (slice + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(cpf.charAt(9)) && calc(10) === parseInt(cpf.charAt(10));
}

function validPhone(raw: string): boolean {
  const d = digitsOnly(raw);
  return d.length >= 10 && d.length <= 13;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const property = getPropertyBySlug(body.propertySlug);
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (!body.checkin || !body.checkout) {
    return NextResponse.json({ error: "Missing dates" }, { status: 400 });
  }

  const guest = body.guest || { name: "", email: "", cpf: "", phone: "" };
  if (!guest.name || guest.name.trim().length < 3) {
    return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
  }
  if (!validEmail(guest.email)) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }
  if (!validCPF(guest.cpf)) {
    return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
  }
  if (!validPhone(guest.phone)) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  const guests = Number(body.guests || 2);
  if (!Number.isFinite(guests) || guests < 1 || guests > property.capacity.max) {
    return NextResponse.json({ error: "Número de hóspedes inválido" }, { status: 400 });
  }

  const quote = await calculatePrice(property.id, body.checkin, body.checkout, guests);
  if (!quote) {
    return NextResponse.json({ error: "Preço indisponível para essas datas" }, { status: 502 });
  }

  let couponDiscount = 0;
  let runningTotal = quote.totalPrice;
  if (body.couponCode) {
    const v = validateCoupon(body.couponCode, {
      nights: quote.nights,
      subtotal: quote.totalPrice,
      paymentMethod: body.paymentMethod === "pix" ? "pix" : "card",
      propertySlug: property.slug,
      checkin: body.checkin,
    });
    if (v.valid) {
      couponDiscount = v.discountAmount;
      runningTotal -= couponDiscount;
    }
  }

  const paymentMethod: "card" | "pix" = body.paymentMethod === "pix" ? "pix" : "card";
  const pixDiscount = paymentMethod === "pix" ? Math.round(runningTotal * 0.03) : 0;
  runningTotal -= pixDiscount;

  const nameParts = guest.name.trim().split(/\s+/);
  const guestFirstName = nameParts[0] || "";
  const guestLastName = nameParts.slice(1).join(" ") || "";

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const draft = {
    id: randomUUID(),
    propertyId: property.slug,
    propertyName: property.name,
    checkin: body.checkin,
    checkout: body.checkout,
    guests,
    nights: quote.nights,
    totalPrice: quote.totalPrice,
    pixDiscount,
    couponCode: body.couponCode?.trim().toUpperCase() || undefined,
    couponDiscount,
    finalTotal: Math.round(runningTotal),
    paymentMethod,
    guestFirstName,
    guestLastName,
    guestEmail: guest.email.trim().toLowerCase(),
    guestPhone: digitsOnly(guest.phone),
    guestCpf: digitsOnly(guest.cpf),
    guestNotes: guest.notes?.trim() || undefined,
    status: "pending" as const,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  try {
    await saveDraft(draft);
  } catch (err) {
    console.error("[draft:POST] saveDraft failed:", err);
    return NextResponse.json({ error: "Erro ao salvar reserva. Tente novamente em instantes." }, { status: 500 });
  }

  return NextResponse.json({
    draftId: draft.id,
    expiresAt: draft.expiresAt,
  });
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ draft: null }, { status: 404 });
  return NextResponse.json({ draft });
}
