/**
 * Camada de I/O do motor de pacotes. Busca tarifa e disponibilidade na Hostaway,
 * injeta no motor puro e devolve o resultado autoritativo.
 *
 * Nada que venha do cliente é aceito como preço. O cliente manda datas, hóspedes,
 * itens removidos e extras escolhidos; todo o resto é recalculado aqui.
 */

import { unstable_cache } from "next/cache";
import { calculatePrice, getCalendar } from "@/lib/hostaway";
import { datasElegiveis, totalDoPacote, noitesDoPacote, motorDoPacote } from "./elegibilidade";
import { listingsForProperty } from "@/config/operational-extras";
import {
  PacoteV2,
  estadiaContemFeriado,
  bonusSaidaPara,
  JANELA_CANCELAMENTO_EXTRAS_DIAS,
} from "@/config/precos-e-extras";
import {
  calcularPacote,
  avaliarBonusSaida,
  dataLimiteCancelamentoExtras,
  EntradaMotor,
  ResultadoMotor,
} from "./pacotes";
import { montarItens, lateCheckoutAtivo, validarDatasPacote, SelecaoExtras } from "./extras";

export type EntradaPacoteServer = {
  pacote: PacoteV2;
  propertySlug: string;
  propertyId: number;
  checkin: string;
  checkout: string;
  guests: number;
  removidos: string[];
  selecao: SelecaoExtras;
};

export type ResultadoPacoteServer =
  | {
      ok: true;
      resultado: ResultadoMotor;
      entrada: EntradaMotor;
      economia: number;
      bonusMotivo: string;
      dataLimiteCancelamentoExtras: string;
    }
  | { ok: false; erro: string; status: number };

/** Dia seguinte a uma data ISO. */
function diaSeguinte(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Noite livre em TODAS as listings da casa (o Completo ocupa as duas). */
async function noiteLivre(propertySlug: string, noite: string): Promise<boolean> {
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

export async function calcularPacoteServer(
  input: EntradaPacoteServer,
): Promise<ResultadoPacoteServer> {
  const { pacote, propertySlug, propertyId, checkin, checkout, guests, removidos, selecao } = input;

  // Mesma porta que o varredor do "a partir de" e o calendário usam.
  const eleg = datasElegiveis(pacote.slug, propertySlug, checkin, checkout);
  if (!eleg.elegivel) return { ok: false, erro: eleg.motivo, status: 400 };

  const contemFeriado = estadiaContemFeriado(checkin, checkout);

  // A Hostaway responde 502/timeout de vez em quando. Uma segunda tentativa
  // resolve a maioria; sem ela o hóspede via erro cru na tela do pacote.
  const quote = await comRetry(() => calculatePrice(propertyId, checkin, checkout, guests));
  if (!quote) {
    return {
      ok: false,
      erro: "Não conseguimos calcular o preço agora. Tente de novo em instantes ou fale com o concierge.",
      status: 502,
    };
  }

  // Itens inclusos (menos os removidos) + extras opcionais, a preço cheio de menu.
  const itens = montarItens({ pacote, propertySlug, checkin, checkout, removidos, selecao });

  // O bônus depende do late estar ativo E da noite seguinte estar livre. Só
  // consultamos o calendário quando o late sobreviveu à remoção.
  const lateAtivo = lateCheckoutAtivo(itens);
  const noiteSeguinteLivre = lateAtivo ? await noiteLivre(propertySlug, diaSeguinte(checkout)) : false;

  const bonus = avaliarBonusSaida({
    lateAtivo,
    noiteSeguinteLivre,
    checkout,
    contemFeriado,
    valorBonus: bonusSaidaPara(propertySlug),
  });

  const entrada: EntradaMotor = {
    noites: quote.nights,
    hostawayTotal: quote.totalPrice,
    itens,
    bonusSaida: bonus.valor,
    absorvido: valorAbsorvido(pacote, quote, guests),
  };

  const resultado = calcularPacote(entrada);

  return {
    ok: true,
    resultado,
    entrada,
    // Economia = Valor total riscado − TOTAL. Fonte única: o motor.
    // A formula antiga (recompor o avulso com progressivo embutido) foi deletada.
    economia: resultado.economia,
    bonusMotivo: bonus.motivo,
    dataLimiteCancelamentoExtras: dataLimiteCancelamentoExtras(
      checkin,
      JANELA_CANCELAMENTO_EXTRAS_DIAS,
    ),
  };
}

// ---------------------------------------------------------------------------
// "A PARTIR DE" — mínimo dos próximos 90 dias, cacheado
// ---------------------------------------------------------------------------

const JANELA_A_PARTIR_DE_DIAS = 90;
const TTL_A_PARTIR_DE = 60 * 60; // 60 min

export type MinimoPacote =
  | { total: number; checkin: string; checkout: string }
  | { total: null; motivo: string };

/**
 * "A partir de": o menor total que a PRÓPRIA PÁGINA do pacote exibiria.
 *
 * Varre os próximos 90 dias, aceita apenas datas que `datasElegiveis` aprova —
 * a mesma função do calendário e do draft — e calcula com `totalDoPacote`, o
 * mesmo caminho de preço da página, seja motor V2 ou legado.
 *
 * Não existe cálculo próprio aqui. Se o número aparece no card, existe uma data
 * concreta em que reservar entrega exatamente ele.
 */
export function totalMinimoDoPacote(slug: string, propertySlug: string): Promise<MinimoPacote> {
  // Cache do PRÓPRIO Next, não Upstash.
  //
  // O SDK do Upstash faz `fetch` com `no-store`, e o Next proíbe isso dentro de
  // página com `revalidate`: derruba a geração estática com DYNAMIC_SERVER_USAGE
  // e quebra o build. O cache do Next dá o mesmo TTL sem tirar a home do estático.
  return unstable_cache(
    () => calcularMinimo(slug, propertySlug),
    ["pacotes:minimo", slug, propertySlug],
    { revalidate: TTL_A_PARTIR_DE, tags: ["pacotes-minimo"] },
  )();
}

async function calcularMinimo(slug: string, propertySlug: string): Promise<MinimoPacote> {
  const noites = noitesDoPacote(slug);
  if (!noites) return { total: null, motivo: "pacote-desconhecido" };

  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return { total: null, motivo: "sem-listing" };

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hoje = new Date();

  // A varredura percorre a janela do PRÓPRIO pacote, não 90 dias fixos.
  //
  // Um sazonal de dezembro não é alcançado por uma janela contada de hoje, e o
  // resultado era um valor vindo de data não elegível — barato e inalcançável,
  // justamente no produto de maior demanda do ano.
  const janela = janelaDeVarredura(slug, hoje);
  if (!janela) return { total: null, motivo: "fora-da-temporada" };
  const { inicio, dias } = janela;

  // Uma semana a mais: o bônus de saída olha a noite seguinte ao check-out.
  const fim = new Date(inicio.getTime() + (dias + 8) * 86400000);

  let noitesCal: Map<string, { livre: boolean; preco: number }>;
  try {
    const calendarios = await Promise.all(
      listings.map((id) => getCalendar(id, iso(inicio), iso(fim))),
    );
    if (calendarios.some((c) => c.length === 0)) {
      return { total: null, motivo: "calendario-vazio" };
    }
    noitesCal = combinarCalendarios(calendarios);
  } catch (err) {
    console.error("[totalMinimoDoPacote] calendário indisponível:", err);
    return { total: null, motivo: "calendario-indisponivel" };
  }

  let melhor: MinimoPacote = { total: null, motivo: "sem-data-elegivel-livre" };

  for (let offset = 0; offset < dias; offset++) {
    const checkin = iso(new Date(inicio.getTime() + offset * 86400000));
    const checkout = somarDias(checkin, noites);

    // MESMA elegibilidade do calendário e do draft.
    if (!datasElegiveis(slug, propertySlug, checkin, checkout).elegivel) continue;

    let hostawayTotal = 0;
    let completa = true;
    for (let n = 0; n < noites; n++) {
      const noite = noitesCal.get(somarDias(checkin, n));
      if (!noite || !noite.livre) {
        completa = false;
        break;
      }
      hostawayTotal += noite.preco;
    }
    if (!completa) continue;

    // MESMO caminho de preço da página.
    const calc = totalDoPacote({
      slug,
      propertySlug,
      checkin,
      checkout,
      hostawayTotal,
      noites,
      noiteSeguinteLivre: noitesCal.get(checkout)?.livre ?? false,
    });
    if (!calc) continue;

    if (melhor.total === null || calc.total < melhor.total) {
      melhor = { total: calc.total, checkin, checkout };
    }
  }

  return melhor;
}

/**
 * Funde os calendários das listings numa linha do tempo só.
 *
 * O Solarium Completo ocupa as duas casas: a noite só está livre se estiver livre
 * nas duas, e o preço é a soma. Casa individual passa direto.
 */
function combinarCalendarios(
  calendarios: { date: string; isAvailable: number; price: number }[][],
): Map<string, { livre: boolean; preco: number }> {
  const mapa = new Map<string, { livre: boolean; preco: number }>();

  for (const dia of calendarios[0]) {
    const outras = calendarios.slice(1).map((c) => c.find((d) => d.date === dia.date));
    if (outras.some((o) => !o)) continue;

    const livre = dia.isAvailable === 1 && outras.every((o) => o!.isAvailable === 1);
    const preco =
      (Number.isFinite(dia.price) ? dia.price : 0) +
      outras.reduce((soma, o) => soma + (Number.isFinite(o!.price) ? o!.price : 0), 0);

    mapa.set(dia.date, { livre, preco });
  }
  return mapa;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


/**
 * Duas tentativas com uma pausa curta. A Hostaway falha de forma intermitente e
 * um erro cru na tela custa a reserva; repetir uma vez custa 400ms.
 */
async function comRetry<T>(fn: () => Promise<T | null>, tentativas = 2): Promise<T | null> {
  for (let i = 1; i <= tentativas; i++) {
    const r = await fn();
    if (r) return r;
    if (i < tentativas) {
      console.warn(`[pacote-server] tentativa ${i} falhou, repetindo`);
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  return null;
}

/**
 * Taxa de hóspede adicional que o pacote absorve.
 *
 * O Dois Casais é vendido para quatro pessoas: o terceiro e o quarto hóspede
 * aparecem no Valor total pelo que a Hostaway cobra e voltam como desconto de
 * valor idêntico. Do quinto em diante, cobrança normal.
 *
 * O preço por pessoa vem da Hostaway em runtime — nunca escrito aqui.
 */
function valorAbsorvido(
  pacote: PacoteV2,
  quote: { nights: number; raw?: unknown },
  guests: number,
): number {
  const ate = pacote.hospedesAbsorvidosAte;
  if (!ate) return 0;

  const fees = (quote.raw as { listingFees?: Record<string, number> } | undefined)?.listingFees;
  const inclusos = Number(fees?.guestsIncluded ?? 2);
  const porPessoa = Number(fees?.priceForExtraPerson ?? 0);
  if (!porPessoa) return 0;

  const absorvidos = Math.max(0, Math.min(guests, ate) - inclusos);
  return absorvidos * porPessoa * quote.nights;
}


/**
 * Janela que a varredura precisa percorrer para este pacote.
 *
 * Pacote sem sazonalidade: os próximos 90 dias. Pacote com janela de check-in
 * (Final de Ano): a própria janela, resolvida para a ocorrência mais próxima que
 * ainda não passou. Fora da temporada, devolve null — e o card mostra
 * "Consultar datas" em vez de um número de data não elegível.
 */
function janelaDeVarredura(
  slug: string,
  hoje: Date,
): { inicio: Date; dias: number } | null {
  const m = motorDoPacote(slug);
  const janela = m?.motor === "v2" ? m.pacote.janelaCheckin : undefined;
  if (!janela) return { inicio: hoje, dias: JANELA_A_PARTIR_DE_DIAS };

  const ano = hoje.getFullYear();
  for (const a of [ano, ano + 1]) {
    const inicio = new Date(`${a}-${janela.de}T12:00:00`);
    const fim = new Date(`${janela.de <= janela.ate ? a : a + 1}-${janela.ate}T12:00:00`);
    if (fim < hoje) continue;
    const de = inicio < hoje ? hoje : inicio;
    const dias = Math.ceil((fim.getTime() - de.getTime()) / 86400000) + 1;
    if (dias > 0) return { inicio: de, dias };
  }
  return null;
}
