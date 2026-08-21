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
  PACOTES_V2,
  pacoteVisivelHoje,
  type PacoteV2,
} from "@/config/precos-e-extras";
import {
  getPackageBySlug,
  validatePackageDates,
  packageTotalActive,
  type PackageConfig,
} from "@/config/packages";
import { validarDatasPacote, montarItens, lateCheckoutAtivo } from "./extras";
import {
  calcularPacote,
  avaliarBonusSaida,
  type ResultadoMotor,
  type EntradaMotor,
} from "./pacotes";
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
  /** A entrada exata que gerou o resultado, para quem precisa registrar. */
  entrada?: EntradaMotor;
  /** Por que o bônus de saída entrou ou não. */
  bonusMotivo?: string;
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

  const entrada: EntradaMotor = {
    noites: params.noites,
    hostawayTotal: params.hostawayTotal,
    itens,
    bonusSaida: bonus.valor,
    absorvido: params.absorvido ?? 0,
    ajusteTaxa: ajusteTaxaDoCheckout(m.pacote, params.checkout),
  };
  const resultado = calcularPacote(entrada);

  return { total: resultado.total, resultado, entrada, bonusMotivo: bonus.motivo };
}

/** Ajuste de taxa configurado para o dia da semana do check-out. */
function ajusteTaxaDoCheckout(pacote: PacoteV2, checkout: string): number {
  const tabela = pacote.ajusteTaxaPorCheckoutDow;
  if (!tabela) return 0;
  const dow = new Date(checkout + "T12:00:00").getDay();
  return tabela[dow] ?? 0;
}

/** Hóspedes com que o pacote é vendido por padrão — base do "a partir de". */
export function hospedesBase(slug: string): number {
  const m = motorDoPacote(slug);
  if (!m) return 2;
  return m.motor === "v2" ? (m.pacote.hospedesMin ?? 2) : 2;
}


// ---------------------------------------------------------------------------
// VISIBILIDADE — fonte única para a home e para /pacotes
// ---------------------------------------------------------------------------

/**
 * Slugs visíveis hoje, na ordem de prioridade.
 *
 * A home aplica APENAS a truncagem para 3 cards sobre este resultado; nenhuma
 * outra regra em separado. Era caminho paralelo — o Final de Ano aparecia na home
 * e não em /pacotes, o mesmo problema que a rodada 7 eliminou no "a partir de".
 */
export function pacotesVisiveis(hoje: string): string[] {
  // Lista inteiramente derivada do catálogo. O Meio de Semana e a Imersão eram
  // acrescentados à mão porque viviam no motor antigo; migrados, entram pela
  // mesma porta que os demais e passaram a ser cotáveis pela API.
  return PACOTES_V2.filter((p) => p.ativo && pacoteVisivelHoje(p, hoje))
    .sort((a, b) => a.prioridadeHome - b.prioridadeHome)
    .map((p) => p.slug);
}


/**
 * Check-out sugerido ao escolher a chegada.
 *
 * Quando o pacote define um dia da semana de saída, devolve a PRÓXIMA ocorrência
 * dele que respeite a duração mínima — para o Final de Ano, sempre o domingo da
 * semana seguinte. Sem isso a sugestão era "chegada + noitesMin", que caía em
 * dia recusado pelo próprio pacote.
 */
export function checkoutSugerido(slug: string, checkin: string): string | null {
  const m = motorDoPacote(slug);
  if (!m) return null;

  const noitesMin = m.motor === "v2" ? m.pacote.noitesMin : m.pacote.nights;
  const alvo = m.motor === "v2" ? m.pacote.checkoutSugeridoDow : undefined;

  const d = new Date(checkin + "T12:00:00");
  d.setDate(d.getDate() + noitesMin);

  if (alvo !== undefined) {
    // Anda até o dia da semana alvo, sem nunca encurtar abaixo do mínimo.
    while (d.getDay() !== alvo) d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// ---------------------------------------------------------------------------
// ALTERNATIVA — sempre uma URL real, nunca um rótulo de tipo
// ---------------------------------------------------------------------------

export type Alternativa = { rotulo: string; href: string };

/**
 * Próxima data de check-in que o pacote aceita, a partir de uma data.
 *
 * Puro: não consulta calendário. Serve para montar o link — a disponibilidade é
 * verificada quando a pessoa chega na página.
 */
export function proximaDataElegivel(
  slug: string,
  aPartirDe: string,
  maxDias = 400,
): { checkin: string; checkout: string } | null {
  const noites = noitesDoPacote(slug);
  const m = motorDoPacote(slug);
  if (!noites || !m) return null;
  const casa = m.motor === "v2" ? m.pacote.properties[0] : m.pacote.properties[0];

  const base = new Date(aPartirDe + "T12:00:00");
  for (let i = 1; i <= maxDias; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const checkin = iso(d);
    const sugerido = checkoutSugerido(slug, checkin);
    const candidatos = sugerido ? [sugerido] : [];
    // Duração variável: tenta também o mínimo, caso o sugerido não feche.
    candidatos.push(iso(new Date(d.getTime() + noites * 86400000)));
    for (const checkout of candidatos) {
      if (datasElegiveis(slug, casa, checkin, checkout).elegivel) {
        return { checkin, checkout };
      }
    }
  }
  return null;
}

/**
 * Link de alternativa quando as datas não fecham o pacote.
 *
 * SEMPRE uma URL real. Antes o campo carregava o TIPO da alternativa
 * ("outro-pacote") e a tela usava esse valor direto como `href` — relativo à
 * página do pacote, dava `/pacotes/outro-pacote`, que não existe. O bug voltou
 * duas vezes porque as correções mexiam no valor, não no fato de um rótulo estar
 * servindo de endereço.
 */
export function alternativaPara(slug: string, aPartirDe: string): Alternativa {
  const prox = proximaDataElegivel(slug, aPartirDe);
  if (prox) {
    return {
      rotulo: "Ver a próxima data que fecha este pacote",
      href: `/pacotes/${slug}?checkin=${prox.checkin}&checkout=${prox.checkout}`,
    };
  }
  return { rotulo: "Ver as casas livres no período", href: "/#busca" };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
