import { NextRequest, NextResponse } from "next/server";
import { createDraft, getDraft } from "@/lib/reservations-store";
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
    const v = validateCoupon(body.couponCode, quote.nights, quote.totalPrice);
    if (v.valid) {
      couponDiscount = v.discountAmount;
      runningTotal -= couponDiscount;
    }
  }

  const paymentMethod: "card" | "pix" = body.paymentMethod === "pix" ? "pix" : "card";
  const pixDiscount = paymentMethod === "pix" ? runningTotal * 0.03 : 0;
  runningTotal -= pixDiscount;

  const draft = createDraft({
    propertyId: property.id,
    propertySlug: property.slug,
    propertyName: property.name,
    checkin: body.checkin,
    checkout: body.checkout,
    guests,
    paymentMethod,
    couponCode: body.couponCode?.trim().toUpperCase() || undefined,
    totals: {
      nights: quote.nights,
      subtotal: quote.totalPrice,
      cleaningFee: quote.cleaningFee,
      discount: quote.discount,
      couponDiscount,
      pixDiscount,
      total: runningTotal,
    },
    guest: {
      name: guest.name.trim(),
      email: guest.email.trim().toLowerCase(),
      cpf: digitsOnly(guest.cpf),
      phone: digitsOnly(guest.phone),
      notes: guest.notes?.trim() || undefined,
    },
  });

  return NextResponse.json({
    draftId: draft.id,
    expiresAt: new Date(draft.expiresAt).toISOString(),
  });
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const draft = getDraft(id);
  if (!draft) return NextResponse.json({ error: "Not found or expired" }, { status: 404 });
  return NextResponse.json(draft);
}
