import { NextRequest, NextResponse } from "next/server";
import { getPacoteV2, estadiaContemFeriado } from "@/config/precos-e-extras";
import { getPropertyBySlug } from "@/config/properties";
import { pacotesV2Ativo } from "@/config/flags";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { validarDatasPacote, extrasExibiveis } from "@/lib/pricing/extras";
import { listingsForProperty } from "@/config/operational-extras";
import { getCalendar } from "@/lib/hostaway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preço de um pacote para datas concretas. É a MESMA função que o draft usa, então
 * o que a tela mostra e o que o servidor cobra não podem divergir.
 *
 * Nenhum valor vindo do cliente é aceito: só datas, hóspedes, remoções e seleção.
 */
export async function POST(req: NextRequest) {
  if (!pacotesV2Ativo()) {
    return NextResponse.json({ error: "indisponível" }, { status: 404 });
  }

  let body: {
    pacoteId?: string;
    propertySlug?: string;
    checkin?: string;
    checkout?: string;
    guests?: number;
    removidos?: string[];
    selecaoExtras?: Record<string, number>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const pacote = body.pacoteId ? getPacoteV2(body.pacoteId) : undefined;
  const property = body.propertySlug ? getPropertyBySlug(body.propertySlug) : undefined;
  if (!pacote || !property) {
    return NextResponse.json({ error: "Pacote ou casa não encontrados." }, { status: 404 });
  }
  if (!body.checkin || !body.checkout) {
    return NextResponse.json({ error: "Datas obrigatórias." }, { status: 400 });
  }

  // Datas incompatíveis são recusadas AQUI, com o motivo, para a tela bloquear o
  // CTA antes do cliente preencher qualquer coisa.
  const contemFeriado = estadiaContemFeriado(body.checkin, body.checkout);
  const v = validarDatasPacote(pacote, body.checkin, body.checkout, contemFeriado);
  if (!v.valido) {
    return NextResponse.json(
      { compativel: false, motivo: v.motivo, alternativa: v.alternativa ?? null },
      { status: 200 },
    );
  }

  const calc = await calcularPacoteServer({
    pacote,
    propertySlug: property.slug,
    propertyId: property.id,
    checkin: body.checkin,
    checkout: body.checkout,
    guests: Number(body.guests) || 2,
    removidos: Array.isArray(body.removidos) ? body.removidos : [],
    selecao: body.selecaoExtras ?? {},
  });

  if (!calc.ok) {
    return NextResponse.json({ compativel: false, motivo: calc.erro }, { status: calc.status });
  }

  const noitesLivres = await checarNoitesAdjacentes(property.slug, body.checkin, body.checkout);
  const hoje = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    compativel: true,
    total: calc.resultado.total,
    hostawayTotal: calc.resultado.hostawayTotal,
    subtotal: calc.resultado.subtotal,
    baseDesconto: calc.resultado.baseDesconto,
    descontoTotal: calc.resultado.descontoTotal,
    itens: calc.resultado.itens,
    noites: calc.resultado.noites,
    economia: calc.resultado.economia,
    descontoFixo: calc.resultado.descontoFixo,
    absorvido: calc.resultado.absorvido,
    bonusAplicado: calc.resultado.bonusSaida > 0,
    dataLimiteCancelamentoExtras: calc.dataLimiteCancelamentoExtras,
    disponiveis: extrasExibiveis(property.slug, {
      checkin: body.checkin,
      checkout: body.checkout,
      hoje,
      noitesLivres,
    }),
  });
}

/** Noite anterior ao check-in e noite do check-out, para early e late. */
async function checarNoitesAdjacentes(
  propertySlug: string,
  checkin: string,
  checkout: string,
): Promise<Record<string, boolean>> {
  const anterior = (() => {
    const d = new Date(checkin + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const listings = listingsForProperty(propertySlug);
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

  const [early, late] = await Promise.all([livre(anterior), livre(checkout)]);
  return { early_checkin: early, late_checkout: late };
}
