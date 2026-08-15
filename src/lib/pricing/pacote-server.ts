/**
 * Camada de I/O do motor de pacotes. Busca tarifa e disponibilidade na Hostaway,
 * injeta no motor puro e devolve o resultado autoritativo.
 *
 * Nada que venha do cliente é aceito como preço. O cliente manda datas, hóspedes,
 * itens removidos e extras escolhidos; todo o resto é recalculado aqui.
 */

import { Redis } from "@upstash/redis";
import { calculatePrice, getCalendar } from "@/lib/hostaway";
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
  economiaVsAvulso,
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

  if (!pacote.properties.includes(propertySlug)) {
    return { ok: false, erro: "Este pacote não está disponível para esta casa.", status: 400 };
  }

  const contemFeriado = estadiaContemFeriado(checkin, checkout);
  const v = validarDatasPacote(pacote, checkin, checkout, contemFeriado);
  if (!v.valido) return { ok: false, erro: v.motivo, status: 400 };

  const quote = await calculatePrice(propertyId, checkin, checkout, guests);
  if (!quote) {
    return { ok: false, erro: "Preço indisponível para essas datas.", status: 502 };
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
    economia: economiaVsAvulso(entrada, resultado.total),
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

function redisOpcional(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

/**
 * Menor diária dos próximos 90 dias por listing, para o "a partir de" dos cards.
 *
 * Cacheado no Upstash com TTL de 60 min: consultar a Hostaway a cada render de
 * home é inviável, e o número não precisa ser fresco ao minuto.
 */
export async function diariaMinima(propertySlug: string): Promise<number | null> {
  const chave = `pacotes:apartirde:${propertySlug}`;
  const redis = redisOpcional();

  if (redis) {
    try {
      const cache = await redis.get<number>(chave);
      if (typeof cache === "number" && cache > 0) return cache;
    } catch (err) {
      console.warn("[diariaMinima] cache indisponível:", err);
    }
  }

  const listings = listingsForProperty(propertySlug);
  if (listings.length === 0) return null;

  const inicio = new Date();
  const fim = new Date(inicio.getTime() + JANELA_A_PARTIR_DE_DIAS * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const porListing = await Promise.all(
      listings.map(async (id) => {
        const dias = await getCalendar(id, iso(inicio), iso(fim));
        const precos = dias
          .filter((d) => d.isAvailable === 1 && Number.isFinite(d.price) && d.price > 0)
          .map((d) => d.price);
        return precos.length > 0 ? Math.min(...precos) : null;
      }),
    );

    const validos = porListing.filter((v): v is number => v !== null);
    if (validos.length === 0) return null;

    // Completo = soma das duas casas; individuais = o próprio mínimo.
    const minimo = propertySlug === "solarium-completo"
      ? validos.reduce((s, v) => s + v, 0)
      : Math.min(...validos);

    if (redis) {
      try {
        await redis.set(chave, minimo, { ex: TTL_A_PARTIR_DE });
      } catch {
        // cache é otimização, não pode derrubar a página
      }
    }
    return minimo;
  } catch (err) {
    console.error("[diariaMinima]", err);
    return null;
  }
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
