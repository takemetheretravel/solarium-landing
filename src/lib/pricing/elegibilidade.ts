/**
 * ELEGIBILIDADE E PREÇO — ponto de entrada ÚNICO, puro, sem I/O.
 *
 * Existe para que a página do pacote, o calendário, o draft e o varredor do
 * "a partir de" respondam sempre a mesma coisa. Enquanto havia caminhos
 * paralelos, o card anunciava datas que a própria página recusava.
 *
 * Os dois motores convivem aqui: o V2 e o legado (Meio de Semana e Imersão, que
 * seguem com preço e regra inalterados). Quem chama não precisa saber qual é.
 */

import {
  getPacoteV2,
  estadiaContemFeriado,
  type PacoteV2,
} from "@/config/precos-e-extras";
import {
  getPackageBySlug,
  validatePackageDates,
  packageTotalActive,
  type PackageConfig,
} from "@/config/packages";
import { validarDatasPacote, montarItens, lateCheckoutAtivo } from "./extras";
import { calcularPacote, avaliarBonusSaida, type ResultadoMotor } from "./pacotes";
import { bonusSaidaPara } from "@/config/precos-e-extras";

export type MotorDoPacote =
  | { motor: "v2"; pacote: PacoteV2 }
  | { motor: "legado"; pacote: PackageConfig };

/** Qual motor rege este slug. V2 tem precedência; o legado cobre o resto. */
export function motorDoPacote(slug: string): MotorDoPacote | null {
  const v2 = getPacoteV2(slug);
  if (v2) return { motor: "v2", pacote: v2 };
  const legado = getPackageBySlug(slug);
  if (legado) return { motor: "legado", pacote: legado };
  return null;
}

export type Elegibilidade = { elegivel: true } | { elegivel: false; motivo: string };

/**
 * A ÚNICA pergunta "estas datas fecham este pacote?".
 *
 * Calendário, validação de datas e varredor chamam esta função. Nenhuma data
 * pode ser aceita por um e recusada por outro.
 */
export function datasElegiveis(
  slug: string,
  propertySlug: string,
  checkin: string,
  checkout: string,
): Elegibilidade {
  const m = motorDoPacote(slug);
  if (!m) return { elegivel: false, motivo: "Pacote não encontrado." };

  if (m.motor === "v2") {
    if (!m.pacote.properties.includes(propertySlug)) {
      return { elegivel: false, motivo: "Este pacote não está disponível para esta casa." };
    }
    const v = validarDatasPacote(
      m.pacote,
      checkin,
      checkout,
      estadiaContemFeriado(checkin, checkout),
    );
    return v.valido ? { elegivel: true } : { elegivel: false, motivo: v.motivo };
  }

  if (!m.pacote.properties.includes(propertySlug)) {
    return { elegivel: false, motivo: "Este pacote não está disponível para esta casa." };
  }
  const v = validatePackageDates(m.pacote, checkin, checkout);
  return v.valid ? { elegivel: true } : { elegivel: false, motivo: v.reason };
}

/** Noites exatas que o pacote exige. Usado pelo varredor para montar a janela. */
export function noitesDoPacote(slug: string): number | null {
  const m = motorDoPacote(slug);
  if (!m) return null;
  return m.motor === "v2" ? m.pacote.noitesMin : m.pacote.nights;
}

export type TotalDoPacote = {
  total: number;
  /** Presente só no motor V2 — o legado não tem linhas detalhadas. */
  resultado?: ResultadoMotor;
};

/**
 * Total que a PÁGINA do pacote exibiria, dados a tarifa Hostaway e o estado do
 * calendário. Puro: o I/O fica com quem chama.
 *
 * É esta função que o varredor do "a partir de" usa, exatamente como a página.
 * Mudou o preço aqui, mudou nos dois lugares — não há como divergirem.
 */
export function totalDoPacote(params: {
  slug: string;
  propertySlug: string;
  checkin: string;
  checkout: string;
  /** Diárias + hóspede extra + limpeza, da Hostaway. */
  hostawayTotal: number;
  noites: number;
  /** Para o bônus de saída. Só o motor V2 usa. */
  noiteSeguinteLivre?: boolean;
  removidos?: string[];
  selecao?: Record<string, number>;
  /** Absorção de hóspede adicional (Dois Casais). Só o motor V2 usa. */
  absorvido?: number;
}): TotalDoPacote | null {
  const m = motorDoPacote(params.slug);
  if (!m) return null;

  // Motor legado: desconto de estadia + extras a preço cheio. Fórmula intocada.
  if (m.motor === "legado") {
    return { total: packageTotalActive(m.pacote, params.hostawayTotal, null) };
  }

  const itens = montarItens({
    pacote: m.pacote,
    propertySlug: params.propertySlug,
    checkin: params.checkin,
    checkout: params.checkout,
    removidos: params.removidos ?? [],
    selecao: params.selecao ?? {},
  });

  const bonus = avaliarBonusSaida({
    lateAtivo: lateCheckoutAtivo(itens),
    noiteSeguinteLivre: params.noiteSeguinteLivre ?? false,
    checkout: params.checkout,
    contemFeriado: estadiaContemFeriado(params.checkin, params.checkout),
    valorBonus: bonusSaidaPara(params.propertySlug),
  });

  const resultado = calcularPacote({
    noites: params.noites,
    hostawayTotal: params.hostawayTotal,
    itens,
    bonusSaida: bonus.valor,
    absorvido: params.absorvido ?? 0,
  });

  return { total: resultado.total, resultado };
}

/** Hóspedes com que o pacote é vendido por padrão — base do "a partir de". */
export function hospedesBase(slug: string): number {
  const m = motorDoPacote(slug);
  if (!m) return 2;
  return m.motor === "v2" ? (m.pacote.hospedesMin ?? 2) : 2;
}
