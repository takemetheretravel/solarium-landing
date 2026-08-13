import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveDraft, getDraft } from "@/lib/kv-store";
import { calculatePrice, getCalendar } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { validateCoupon } from "@/config/site";
import { getPackageBySlug, validatePackageDates, packageTotalActive, extrasTotalActive, isExtraActive } from "@/config/packages";
import { getServiceExtra, serviceExtraTotal, CAFE_EXTRA_IDS, MAX_QTY_PER_EXTRA } from "@/config/service-extras";
import { OpExtraType, OP_EXTRA_TYPES, OP_EXTRA_LABELS, blockedNightFor, opExtraPrice, listingsForProperty } from "@/config/operational-extras";
import { getPacoteV2, PacoteV2 } from "@/config/precos-e-extras";
import { pacotesV2Ativo, reservaTeste } from "@/config/flags";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { aplicarPix } from "@/lib/pricing/pacotes";
import type { PropertyConfig } from "@/config/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  propertySlug: string;
  checkin: string;
  checkout: string;
  guests: number;
  paymentMethod?: "card" | "pix";
  couponCode?: string;
  /** Pacotes V2. Presente = cupom rejeitado, motor novo assume o cálculo. */
  pacoteId?: string;
  /** Ids de itens inclusos removíveis que o cliente removeu. */
  removidos?: string[];
  /** Extras opcionais escolhidos: { extraId: quantidade }. */
  selecaoExtras?: Record<string, number>;
  packageSlug?: string;
  packageChoices?: string; // labels das opções escolhidas, separados por "|"
  extrasActive?: string;   // labels dos extras ativos (removíveis omitidos saem), separados por "|"
  serviceExtras?: { id: string; qty: number }[]; // extras de serviço com quantidade (massagem, cestas)
  opExtras?: string[]; // tipos operacionais selecionados (early_checkin, late_checkout)
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

  // ---------------------------------------------------------------------
  // PACOTES V2 — caminho próprio, motor novo, cupom bloqueado
  // ---------------------------------------------------------------------
  if (body.pacoteId) {
    if (!pacotesV2Ativo()) {
      return NextResponse.json({ error: "Pacote indisponível." }, { status: 404 });
    }
    const pacote = getPacoteV2(body.pacoteId);
    if (!pacote) {
      return NextResponse.json({ error: "Pacote não encontrado." }, { status: 404 });
    }

    // Cupom não combina com pacote. Sem exceção, sem código de operador, sem
    // override: qualquer código enviado junto de um pacote derruba a requisição.
    if (body.couponCode && body.couponCode.trim()) {
      return NextResponse.json(
        { error: "Este pacote já inclui a melhor condição disponível para estas datas." },
        { status: 400 },
      );
    }

    return criarDraftPacote({ body, property, pacote, guest, guests });
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

  // Extras de serviço (massagem, cestas): REVALIDA quantidade e preço no server pelo config.
  // Quantidade é independente das noites. Somados após cupom e Pix (não recebem desconto).
  // Se o pacote já inclui café, descartar cestas (evita duplicar).
  let serviceExtras: { id: string; label: string; qty: number; price: number }[] | undefined;
  const serviceItemsRequested = Array.isArray(body.serviceExtras) ? body.serviceExtras : [];
  if (serviceItemsRequested.length > 0) {
    const packageHasCafe = Boolean(
      pkg && pkg.extras.some((e) => /café da manhã|cesta de café/i.test(e.label)),
    );
    const resolved = serviceItemsRequested
      .map((item) => {
        const cfg = getServiceExtra(item?.id);
        if (!cfg) return null;
        if (packageHasCafe && CAFE_EXTRA_IDS.includes(cfg.id)) return null;
        const qty = Math.min(Math.max(0, Math.floor(Number(item?.qty) || 0)), MAX_QTY_PER_EXTRA);
        if (qty <= 0) return null;
        return { id: cfg.id, label: cfg.label, qty, price: serviceExtraTotal(cfg.id, qty) };
      })
      .filter((e): e is { id: string; label: string; qty: number; price: number } => e !== null && e.price > 0);
    if (resolved.length > 0) serviceExtras = resolved;
    console.log("[Draft] serviceExtras:", JSON.stringify(resolved));
  }
  const serviceExtrasSum = (serviceExtras ?? []).reduce((s, e) => s + e.price, 0);

  // Extras operacionais (early/late): REVALIDA preço e RECONFIRMA disponibilidade da
  // noite adjacente no calendário (todas as listings da casa). Descarta os ocupados.
  // Somados após cupom e Pix (não recebem desconto).
  let opExtras: { type: string; label: string; price: number; blockedNight: string }[] | undefined;
  const opTypesRequested = Array.isArray(body.opExtras) ? body.opExtras : [];
  if (opTypesRequested.length > 0) {
    const validTypes = opTypesRequested.filter((t): t is OpExtraType =>
      OP_EXTRA_TYPES.includes(t as OpExtraType),
    );
    const listings = listingsForProperty(property.slug);
    const resolved: { type: string; label: string; price: number; blockedNight: string }[] = [];
    for (const type of validTypes) {
      const night = blockedNightFor(type, body.checkin, body.checkout);
      const checks = await Promise.all(
        listings.map(async (id) => {
          const days = await getCalendar(id, night, night);
          return days.length > 0 && days.every((d) => d.isAvailable === 1);
        }),
      );
      const available = listings.length > 0 && checks.every(Boolean);
      if (!available) continue;
      resolved.push({
        type,
        label: OP_EXTRA_LABELS[type],
        price: opExtraPrice(property.slug, type, body.checkin, body.checkout),
        blockedNight: night,
      });
    }
    if (resolved.length > 0) opExtras = resolved;
    console.log("[Draft] opExtras:", JSON.stringify(resolved));
  }
  const opExtrasSum = (opExtras ?? []).reduce((s, e) => s + e.price, 0);

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
    finalTotal: Math.round(runningTotal) + serviceExtrasSum + opExtrasSum,
    paymentMethod,
    packageSlug: pkg?.slug,
    packageName: pkg?.name,
    extrasTotal: pkgExtrasTotal,
    extrasList: pkgExtrasList,
    shortNotice:
      pkg && body.checkin < new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
        ? true
        : undefined,
    serviceExtras,
    opExtras,
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
    serviceExtras: draft.serviceExtras?.map((e) => `${e.id}@${e.price}`),
    opExtras: draft.opExtras?.map((e) => `${e.type}@${e.price}(${e.blockedNight})`),
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

/**
 * Draft de um pacote V2. Todo o preço é recalculado aqui — o corpo da requisição
 * não carrega nenhum valor, só datas, hóspedes, remoções e extras escolhidos.
 */
async function criarDraftPacote(args: {
  body: Body;
  property: PropertyConfig;
  pacote: PacoteV2;
  guest: Body["guest"];
  guests: number;
}): Promise<NextResponse> {
  const { body, property, pacote, guest, guests } = args;

  const calc = await calcularPacoteServer({
    pacote,
    propertySlug: property.slug,
    propertyId: property.id,
    checkin: body.checkin,
    checkout: body.checkout,
    guests,
    removidos: Array.isArray(body.removidos) ? body.removidos : [],
    selecao: sanearSelecao(body.selecaoExtras),
  });

  if (!calc.ok) {
    return NextResponse.json({ error: calc.erro }, { status: calc.status });
  }

  const { resultado } = calc;
  const paymentMethod: "card" | "pix" = body.paymentMethod === "pix" ? "pix" : "card";

  // Segunda e última aplicação do piso de dezena.
  const pix = paymentMethod === "pix" ? aplicarPix(resultado.total) : { desconto: 0, total: resultado.total };

  const nameParts = guest.name.trim().split(/\s+/);
  const prefixo = reservaTeste() ? "[TESTE] " : "";

  const now = new Date();
  const draft = {
    id: randomUUID(),
    propertyId: property.slug,
    propertyName: property.name,
    checkin: body.checkin,
    checkout: body.checkout,
    guests,
    nights: resultado.noites,
    totalPrice: resultado.hostawayTotal,
    subtotal: resultado.subtotal,
    pixDiscount: pix.desconto,
    couponCode: undefined,
    couponDiscount: 0,
    discountAmount: resultado.descontoTotal + pix.desconto,
    finalTotal: pix.total,
    paymentMethod,
    pacoteId: pacote.id,
    pacoteNome: pacote.nome,
    pacoteItens: resultado.itens,
    baseDesconto: resultado.baseDesconto,
    descontoProgressivo: resultado.descontoProgressivo,
    bonusSaida: resultado.bonusSaida,
    economiaVsAvulso: calc.economia,
    dataLimiteCancelamentoExtras: calc.dataLimiteCancelamentoExtras,
    reservaTeste: reservaTeste() || undefined,
    guestFirstName: prefixo + (nameParts[0] || ""),
    guestLastName: nameParts.slice(1).join(" ") || "",
    guestEmail: guest.email.trim().toLowerCase(),
    guestPhone: normalizePhone(guest.phone),
    guestCpf: digitsOnly(guest.cpf),
    guestNotes: guest.notes?.trim() || undefined,
    status: "pending" as const,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  };

  console.log("[Draft:pacoteV2]", {
    id: draft.id,
    pacote: pacote.id,
    hostaway: resultado.hostawayTotal,
    base: resultado.baseDesconto,
    subtotal: resultado.subtotal,
    desconto: resultado.descontoTotal,
    bonus: `${resultado.bonusSaida} (${calc.bonusMotivo})`,
    totalPacote: resultado.total,
    finalTotal: draft.finalTotal,
    economia: calc.economia,
    limiteCancelamento: draft.dataLimiteCancelamentoExtras,
    teste: draft.reservaTeste ?? false,
  });

  try {
    await saveDraft(draft);
  } catch (err) {
    console.error("[draft:pacoteV2] saveDraft failed:", err);
    return NextResponse.json(
      { error: "Erro ao salvar reserva. Tente novamente em instantes." },
      { status: 500 },
    );
  }

  return NextResponse.json({ draftId: draft.id, expiresAt: draft.expiresAt });
}

/** Quantidades vindas do cliente: inteiras, não negativas, com teto. */
function sanearSelecao(bruto: Record<string, number> | undefined): Record<string, number> {
  if (!bruto || typeof bruto !== "object") return {};
  const limpo: Record<string, number> = {};
  for (const [id, qtd] of Object.entries(bruto)) {
    const n = Math.floor(Number(qtd));
    if (Number.isFinite(n) && n > 0) limpo[id] = n;
  }
  return limpo;
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ draft: null }, { status: 404 });
  return NextResponse.json({ draft });
}
