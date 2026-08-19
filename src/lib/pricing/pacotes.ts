/**
 * MOTOR DE PREÇO DOS PACOTES — função pura, sem I/O.
 *
 * Tudo que depende de rede (tarifa Hostaway, disponibilidade da noite adjacente,
 * calendário de feriados) é injetado como parâmetro. Isso mantém o motor testável
 * isoladamente e garante que o mesmo cálculo rode no servidor e no cliente sem
 * divergir.
 *
 * Base do desconto = total Hostaway (diárias + hóspede extra + limpeza)
 *                  + itens operacionais (early check-in, late check-out).
 * Todos os demais extras entram no subtotal a preço cheio e não recebem desconto.
 */

import { taxaProgressiva } from "@/config/precos-e-extras";

// ---------------------------------------------------------------------------
// ARREDONDAMENTO
// ---------------------------------------------------------------------------

/**
 * Arredonda para a dezena inteira ABAIXO. R$ 3.725,60 → R$ 3.720.
 *
 * Aplicado duas vezes e só duas em toda a jornada: uma no total do pacote, outra
 * depois do desconto Pix. O valor exibido e o valor cobrado têm de ser idênticos
 * ao centavo — nunca arredondar de novo em nenhuma camada de exibição.
 */
export function pisoDezena(valor: number): number {
  return Math.floor(valor / 10) * 10;
}

export const DESCONTO_PIX = 0.03;

/** Segunda e última aplicação do piso de dezena. */
export function aplicarPix(totalPacote: number): { desconto: number; total: number } {
  const total = pisoDezena(totalPacote * (1 - DESCONTO_PIX));
  return { desconto: totalPacote - total, total };
}

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

export type ItemPreco = {
  extraId: string;
  nome: string;
  qtd: number;
  precoUnitario: number;
  /** precoUnitario × qtd. */
  total: number;
  /** Entra na base do desconto progressivo (só early check-in e late check-out). */
  entraNaBase: boolean;
  /** Veio incluso no pacote (vs. escolhido como extra opcional). */
  incluso: boolean;
  /**
   * Quanto DESTE item entra na base do progressivo. Ausente = `total`.
   *
   * Existe porque alguns itens são exibidos ao preço cheio de menu mas custam
   * menos na operação. A diferença não some: vira desconto fixo, fora da base
   * progressiva. O cliente vê o preço de menu na linha e a diferença no desconto.
   */
  valorNaBase?: number;
};

export type EntradaMotor = {
  noites: number;
  /** Total da Hostaway: diárias + hóspede extra + limpeza. Nunca hardcoded. */
  hostawayTotal: number;
  /** Itens inclusos no pacote e extras opcionais, todos a preço cheio de menu. */
  itens: ItemPreco[];
  /** Já resolvido por `avaliarBonusSaida`. Zero quando não aplicável. */
  bonusSaida: number;
  /**
   * Parte do `hostawayTotal` que o pacote absorve: sai da base progressiva e
   * volta como desconto de valor idêntico. Efeito líquido zero sobre o total.
   */
  absorvido?: number;
  /**
   * Ajuste na taxa progressiva, em pontos. Negativo reduz.
   *
   * O Final de Ano tira 5 pontos na saída de sábado: é o dia que deixa a noite
   * de domingo encalhada, e o desconto acompanha isso.
   */
  ajusteTaxa?: number;
};

export type ResultadoMotor = {
  noites: number;
  hostawayTotal: number;
  itens: ItemPreco[];
  /** Total Hostaway + itens operacionais. É sobre isto que o progressivo incide. */
  baseDesconto: number;
  /** Itens a preço cheio que não recebem desconto. */
  itensSemDesconto: number;
  /** baseDesconto + itensSemDesconto, antes de qualquer desconto. */
  subtotal: number;
  taxa: number;
  descontoProgressivo: number;
  bonusSaida: number;
  /** Ajustes de item (preço de menu acima do operacional) + valor absorvido. */
  descontoFixo: number;
  absorvido: number;
  /** Linha única exibida ao cliente: progressivo + bônus + fixos. */
  descontoTotal: number;
  total: number;
  /**
   * O que o cliente lê como economia. É, por construção, a diferença entre o
   * `subtotal` riscado e o `total` — nunca um cálculo paralelo.
   */
  economia: number;
};

// ---------------------------------------------------------------------------
// MOTOR
// ---------------------------------------------------------------------------

export function calcularPacote(entrada: EntradaMotor): ResultadoMotor {
  const { noites, hostawayTotal, itens, bonusSaida } = entrada;
  const absorvido = entrada.absorvido ?? 0;

  const operacionais = itens.filter((i) => i.entraNaBase);
  const cheios = itens.filter((i) => !i.entraNaBase);

  // O subtotal é a soma LITERAL das linhas exibidas, a preço cheio de menu.
  // É o número riscado na tela, e não pode divergir do que está acima dele.
  const subtotal = hostawayTotal + soma(operacionais) + soma(cheios);

  // A base do progressivo usa o valor operacional dos itens, não o de menu, e
  // ignora o que o pacote absorve.
  const baseDesconto = hostawayTotal - absorvido + somaNaBase(operacionais);
  const itensSemDesconto = soma(cheios);

  // Diferença entre o preço de menu exibido e o que entrou na base.
  const ajusteItens = soma(operacionais) - somaNaBase(operacionais);
  const descontoFixo = ajusteItens + absorvido;

  // Nunca abaixo de zero: ajuste não vira acréscimo.
  const taxa = Math.max(0, taxaProgressiva(noites) + (entrada.ajusteTaxa ?? 0));
  const descontoProgressivo = baseDesconto * taxa;
  const descontoTotal = descontoProgressivo + bonusSaida + descontoFixo;

  const total = pisoDezena(subtotal - descontoTotal);

  return {
    noites,
    hostawayTotal,
    itens,
    baseDesconto,
    itensSemDesconto,
    subtotal,
    taxa,
    descontoProgressivo,
    bonusSaida,
    descontoFixo,
    absorvido,
    descontoTotal,
    total,
    economia: subtotal - total,
  };
}

/** Soma o que cada item leva para a base do progressivo (default: o total). */
function somaNaBase(itens: ItemPreco[]): number {
  return itens.reduce((s, i) => s + (i.valorNaBase ?? i.total), 0);
}

function soma(itens: ItemPreco[]): number {
  return itens.reduce((s, i) => s + i.total, 0);
}

// ---------------------------------------------------------------------------
// BÔNUS DE SAÍDA
// ---------------------------------------------------------------------------

export type ContextoBonus = {
  /** Late check-out ativo na reserva — incluso ou contratado. Sem ele, nunca há bônus. */
  lateAtivo: boolean;
  /** Noite imediatamente seguinte ao check-out livre na Hostaway, mesmo listing. */
  noiteSeguinteLivre: boolean;
  /** ISO. O dia da semana decide junto com o feriado. */
  checkout: string;
  /** Estadia contém ao menos um feriado nacional, confirmado pela fonte de feriados. */
  contemFeriado: boolean;
  valorBonus: number;
};

export type ResultadoBonus = {
  aplicavel: boolean;
  valor: number;
  /** Por que não aplicou. Para log e para o PR, nunca exibido ao cliente. */
  motivo: string;
};

/**
 * O bônus paga a noite que dificilmente seria vendida. Aplica quando TODAS as
 * condições são verdadeiras:
 *   1. late check-out ativo;
 *   2. noite seguinte ao check-out livre;
 *   3. check-out em domingo, OU em segunda quando a estadia contém feriado.
 */
export function avaliarBonusSaida(ctx: ContextoBonus): ResultadoBonus {
  if (!ctx.lateAtivo) {
    return { aplicavel: false, valor: 0, motivo: "late check-out não está ativo" };
  }
  if (!ctx.noiteSeguinteLivre) {
    return { aplicavel: false, valor: 0, motivo: "noite seguinte ao check-out está ocupada" };
  }

  const dow = new Date(ctx.checkout + "T12:00:00").getDay();
  const domingo = dow === 0;
  const segundaComFeriado = dow === 1 && ctx.contemFeriado;

  if (!domingo && !segundaComFeriado) {
    return {
      aplicavel: false,
      valor: 0,
      motivo: "check-out não cai em domingo nem em segunda de feriado",
    };
  }

  return {
    aplicavel: true,
    valor: ctx.valorBonus,
    motivo: domingo ? "check-out no domingo" : "check-out na segunda com feriado na estadia",
  };
}

// ---------------------------------------------------------------------------
// COMPARATIVO COM A CONTRATAÇÃO AVULSA
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LAST-MINUTE / EARLY-BIRD
// ---------------------------------------------------------------------------

/**
 * Pacote e tarifa promocional nunca somam. Calcula os dois e devolve o menor total.
 */
export function melhorTotal(totalPacote: number, totalPromocional: number | null): {
  total: number;
  origem: "pacote" | "promocional";
} {
  if (totalPromocional === null || totalPacote <= totalPromocional) {
    return { total: totalPacote, origem: "pacote" };
  }
  return { total: totalPromocional, origem: "promocional" };
}

// ---------------------------------------------------------------------------
// CANCELAMENTO DE EXTRAS
// ---------------------------------------------------------------------------

/**
 * Data-limite para cancelar extras com reembolso integral: check-in menos a janela.
 * A referência é sempre o check-in, nunca a data de entrega do item.
 */
export function dataLimiteCancelamentoExtras(checkin: string, janelaDias: number): string {
  const d = new Date(checkin + "T12:00:00");
  d.setDate(d.getDate() - janelaDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * True quando a contratação já nasce sem direito a reembolso — o check-in está
 * dentro da janela. O cliente precisa ver isso no momento da seleção.
 */
export function extraNaoReembolsavel(checkin: string, janelaDias: number, hoje: string): boolean {
  return hoje > dataLimiteCancelamentoExtras(checkin, janelaDias);
}

/** Dias corridos entre duas datas ISO. */
export function diasAte(de: string, ate: string): number {
  const a = new Date(de + "T12:00:00").getTime();
  const b = new Date(ate + "T12:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
