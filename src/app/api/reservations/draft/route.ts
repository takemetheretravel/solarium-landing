import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveDraft, getDraft } from "@/lib/kv-store";
import { calculatePrice } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { validateCoupon } from "@/config/site";
import { getPackageBySlug, validatePackageDates, packageTotalActive, extrasTotalActive, isExtraActive } from "@/config/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  propertySlug: string;
  checkin: string;
  checkout: string;
  guests: number;
  paymentMethod?: "card" | "pix";
  couponCode?: string;
  packageSlug?: string;
  packageChoices?: string; // labels das opções escolhidas, separados por "|"
  extrasActive?: string;   // labels dos extras ativos (removíveis omitidos saem), separados por "|"
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

function normalizePhone(s: string): string {
  // Preserva o "+" do código internacional, se existir
  const trimmed = (s || "").trim();
  const digits = digitsOnly(trimmed);
  return trimmed.startsWith("+") ? `+${digits}` : digits;
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
  // E.164: 8 a 15 dígitos (aceita números internacionais)
  const d = digitsOnly(raw);
  return d.length >= 8 && d.length <= 15;
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

  // Pacote: revalida tudo server-side — nunca confia no total vindo do client
  const pkg = body.packageSlug ? getPackageBySlug(body.packageSlug) : undefined;
  if (body.packageSlug && !pkg) {
    return NextResponse.json({ error: "Pacote não encontrado" }, { status: 404 });
  }
  if (pkg) {
    if (!pkg.properties.includes(property.slug)) {
      return NextResponse.json({ error: "Este pacote não está disponível para esta casa" }, { status: 400 });
    }
    const dv = validatePackageDates(pkg, body.checkin, body.checkout);
    if (!dv.valid) {
      return NextResponse.json({ error: dv.reason }, { status: 400 });
    }
  }

  const quote = await calculatePrice(property.id, body.checkin, body.checkout, guests);
  if (!quote) {
    return NextResponse.json({ error: "Preço indisponível para essas datas" }, { status: 502 });
  }

  let couponDiscount = 0;
  let runningTotal = quote.totalPrice;
  let subtotal = quote.totalPrice;
  let pkgExtrasTotal: number | undefined;
  let pkgExtrasList: string[] | undefined;

  if (pkg) {
    // REGRA: pacote não combina com cupom — couponCode é ignorado
    // Extras ativos: fixos sempre contam; removíveis só se constam na lista enviada.
    const activeLabels = body.extrasActive
      ? body.extrasActive.split("|").filter(Boolean)
      : null;
    const activeExtras = pkg.extras.filter((e) => isExtraActive(e, activeLabels));
    pkgExtrasTotal = extrasTotalActive(pkg, activeLabels);
    // Opções escolhidas pelo hóspede (mesmo preço — o valor sempre vem do config)
    const chosenLabels = (body.packageChoices || "").split("|").filter(Boolean);
    pkgExtrasList = activeExtras.map((e) => {
      if (e.choices?.length) {
        const chosen =
          e.choices.find((c) => chosenLabels.includes(c.label))?.label ?? e.choices[0].label;
        return `${e.label}: ${chosen} — R$ ${e.price.toFixed(2)}`;
      }
      return e.perNight
        ? `${e.label} ×${pkg.nights} — R$ ${(e.price * pkg.nights).toFixed(2)}`
        : `${e.label} — R$ ${e.price.toFixed(2)}`;
    });
    runningTotal = packageTotalActive(pkg, quote.totalPrice, activeLabels);
    subtotal = quote.totalPrice + pkgExtrasTotal; // valor à la carte (estadia cheia + extras ativos)
  } else if (body.couponCode) {
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
    subtotal,
    pixDiscount,
    couponCode: pkg ? undefined : body.couponCode?.trim().toUpperCase() || undefined,
    couponDiscount,
    discountAmount: pkg ? subtotal - Math.round(runningTotal) : couponDiscount + pixDiscount,
    finalTotal: Math.round(runningTotal),
    paymentMethod,
    packageSlug: pkg?.slug,
    packageName: pkg?.name,
    extrasTotal: pkgExtrasTotal,
    extrasList: pkgExtrasList,
    shortNotice:
      pkg && body.checkin < new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
        ? true
        : undefined,
    guestFirstName,
    guestLastName,
    guestEmail: guest.email.trim().toLowerCase(),
    guestPhone: normalizePhone(guest.phone),
    guestCpf: digitsOnly(guest.cpf),
    guestNotes: guest.notes?.trim() || undefined,
    status: "pending" as const,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  console.log("[Draft] saved:", {
    id: draft.id,
    subtotal: draft.subtotal,
    couponDiscount,
    pixDiscount,
    discountAmount: draft.discountAmount,
    finalTotal: draft.finalTotal,
    couponCode: draft.couponCode,
    packageSlug: draft.packageSlug,
  });

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
