import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { saveDraft, getDraft, DRAFT_TTL } from "@/lib/kv-store";
import { calculatePrice, getCalendar } from "@/lib/hostaway";
import { chegadaPermitida } from "@/lib/pricing/restricoes-chegada";
import { getPropertyBySlug } from "@/config/properties";
import { validateCoupon } from "@/config/site";
import { getPackageBySlug, validatePackageDates, packageTotalActive, extrasTotalActive, isExtraActive } from "@/config/packages";
import { getServiceExtra, serviceExtraTotal, CAFE_EXTRA_IDS, MAX_QTY_PER_EXTRA } from "@/config/service-extras";
import { OpExtraType, OP_EXTRA_TYPES, OP_EXTRA_LABELS, blockedNightFor, opExtraPrice, listingsForProperty } from "@/config/operational-extras";
import { getPacoteV2, getExtra, PacoteV2 } from "@/config/precos-e-extras";
import { pacotesV2Ativo, reservaTeste } from "@/config/flags";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { resolverExtraServicoV2, extrasDuplicados, inclusosAtivos, noiteBloqueada } from "@/lib/pricing/extras";
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
  /** Identificador da tentativa de checkout, aberto no clique do CTA. */
  checkoutId?: string;
  /** gclid/utm da sessão, capturados na primeira página. */
  atribuicao?: {
    gclid?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    landing_page?: string;
    capturado_em?: string;
  } | null;
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

/**
 * Identificadores de medição do navegador, lidos dos cookies na criação do
 * draft.
 *
 * A conversão é enviada server-side depois do webhook, quando o navegador do
 * cliente já não está por perto. Capturar aqui é a última janela em que esses
 * valores existem. Nenhum deles identifica pessoa: são identificadores de
 * sessão de medição.
 *
 * O cookie `_ga` vem como `GA1.1.<client_id>` — o client_id do GA4 são os dois
 * últimos segmentos.
 */
function lerIdsDeMedicao(
  req: NextRequest,
  body: Body,
): {
  gaClientId?: string;
  gaSessionId?: string;
  fbp?: string;
  fbc?: string;
  checkoutId?: string;
  atribuicao?: Body["atribuicao"];
} {
  // `_ga` chega como `GA1.1.XXXXXXX.YYYYYYY`; o client_id do GA4 são os dois
  // últimos segmentos. Formato inesperado resolve para ausente, nunca para lixo.
  const ga = req.cookies.get("_ga")?.value;
  let gaClientId: string | undefined;
  if (ga) {
    const partes = ga.split(".");
    if (partes.length >= 4) {
      const candidato = `${partes[partes.length - 2]}.${partes[partes.length - 1]}`;
      if (/^\d+\.\d+$/.test(candidato)) gaClientId = candidato;
    }
  }

  // `_ga_<CONTAINER>` guarda a sessão. O sufixo é o id do stream, que muda —
  // varremos por prefixo em vez de fixar o nome do cookie.
  let gaSessionId: string | undefined;
  for (const cookie of req.cookies.getAll()) {
    if (!cookie.name.startsWith("_ga_")) continue;
    // Formato `GS1.1.<session_id>.<n>....`
    const partes = (cookie.value || "").split(".");
    if (partes.length >= 3 && /^\d+$/.test(partes[2])) {
      gaSessionId = partes[2];
      break;
    }
  }

  return {
    gaClientId,
    gaSessionId,
    fbp: req.cookies.get("_fbp")?.value || undefined,
    fbc: req.cookies.get("_fbc")?.value || undefined,
    // Vêm do corpo: são de sessionStorage, que o servidor não enxerga.
    // Qualquer um deles ausente persiste como indefinido e NUNCA bloqueia a
    // criação do draft — medição não recusa reserva.
    checkoutId: typeof body.checkoutId === "string" ? body.checkoutId.slice(0, 64) : undefined,
    atribuicao: body.atribuicao ?? undefined,
  };
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

  // ÚLTIMA BARREIRA antes de gerar cobrança.
  //
  // A restrição de chegada vem do PMS e já foi checada no cálculo de preço, mas
  // aquela consulta pode ter sido feita minutos antes, e o calendário muda. Aqui
  // é o ponto sem volta: depois disto o hóspede vai para a tela de pagamento.
  //
  // `indeterminado` também recusa. Vender uma entrada que a Hostaway pode não
  // aceitar custa uma reserva desfeita e uma conversa constrangida; recusar
  // custa um clique a mais e uma saída pelo WhatsApp.
  const chegada = await chegadaPermitida(property.slug, body.checkin);
  if (!chegada.permitida) {
    console.error(
      "[Draft] chegada recusada " +
        JSON.stringify({
          property: property.slug,
          checkin: body.checkin,
          indeterminado: chegada.indeterminado,
        }),
    );
    return NextResponse.json({ error: chegada.motivo }, { status: 400 });
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

    // Item que o pacote já entrega NUNCA pode ser comprado de novo. A interface
    // não oferece, mas preço vindo do cliente nunca é confiável: aqui rejeita.
    const removidos = Array.isArray(body.removidos) ? body.removidos : [];
    const idsPedidos = [
      ...Object.keys(sanearSelecao(body.selecaoExtras)),
      ...(Array.isArray(body.serviceExtras) ? body.serviceExtras.map((e) => e?.id) : []),
      ...(Array.isArray(body.opExtras) ? body.opExtras : []),
    ].filter((id): id is string => Boolean(id));

    // Item que exige noite adjacente livre so entra se ela estiver mesmo livre.
    // A tela agora EXIBE o item indisponivel com o motivo, entao o servidor
    // precisa recusar explicitamente em vez de confiar na interface.
    const opsPedidos = idsPedidos.filter((id) => {
      const cfg = getExtra(id);
      return Boolean(cfg?.exigeNoiteLivre);
    });
    for (const id of opsPedidos) {
      const cfg = getExtra(id)!;
      const noite = noiteBloqueada(id as "early_checkin" | "late_checkout", body.checkin, body.checkout);
      const livre = await noiteLivreEmTodasAsListings(property.slug, noite);
      if (!livre) {
        return NextResponse.json(
          { error: `${cfg.nome} não está disponível nestas datas: a noite de ${noite} já está reservada.` },
          { status: 400 },
        );
      }
    }

    const duplicados = extrasDuplicados(pacote, removidos, idsPedidos);
    if (duplicados.length > 0) {
      const nomes = duplicados.map((id) => getExtra(id)?.nome ?? id).join(", ");
      console.warn("[Draft] extra duplicado rejeitado:", pacote.id, duplicados);
      return NextResponse.json(
        { error: `Este pacote já inclui: ${nomes}. Não é preciso adicionar de novo.` },
        { status: 400 },
      );
    }

    return criarDraftPacote({ body, property, pacote, guest, guests, req });
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
        // Com a flag ligada, o catálogo V2 também resolve. O preço sai sempre do
        // config, nunca do corpo da requisição.
        const v2 = pacotesV2Ativo() ? resolverExtraServicoV2(item?.id) : null;
        const cfg = v2
          ? { id: v2.id, label: v2.label, price: v2.preco }
          : (() => {
              const legado = getServiceExtra(item?.id);
              return legado ? { id: legado.id, label: legado.label, price: legado.price } : null;
            })();
        if (!cfg) return null;
        if (packageHasCafe && CAFE_EXTRA_IDS.includes(cfg.id)) return null;
        const qty = Math.min(Math.max(0, Math.floor(Number(item?.qty) || 0)), MAX_QTY_PER_EXTRA);
        if (qty <= 0) return null;
        const price = v2 ? v2.preco * qty : serviceExtraTotal(cfg.id, qty);
        return { id: cfg.id, label: cfg.label, qty, price };
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
  // Derivado do TTL do Redis: o que a tela promete e o que o store cumpre têm
  // que ser o mesmo número, senão um dos dois mente.
  const expiresAt = new Date(now.getTime() + DRAFT_TTL * 1000);

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
    ...lerIdsDeMedicao(req, body),
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

  // finalTotal e item voltam para o cliente empurrar begin_checkout com o mesmo
  // valor que o servidor calculou — o cliente nunca recompõe preço.
  return NextResponse.json({
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    finalTotal: draft.finalTotal,
    itemId: draft.packageSlug || draft.propertyId,
    itemName: draft.packageName || draft.propertyName,
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
  req: NextRequest;
}): Promise<NextResponse> {
  const { body, property, pacote, guest, guests, req } = args;

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
    ...lerIdsDeMedicao(req, body),
    status: "pending" as const,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL * 1000).toISOString(),
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

  return NextResponse.json({
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    finalTotal: draft.finalTotal,
    itemId: draft.pacoteId,
    itemName: draft.pacoteNome,
  });
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


/** A noite está livre em TODAS as listings físicas da casa (Completo = as duas). */
async function noiteLivreEmTodasAsListings(propertySlug: string, noite: string): Promise<boolean> {
  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return false;
  const checks = await Promise.all(
    listings.map(async (id) => {
      const dias = await getCalendar(id, noite, noite);
      return dias.length > 0 && dias.every((d) => d.isAvailable === 1);
    }),
  );
  return checks.every(Boolean);
}
