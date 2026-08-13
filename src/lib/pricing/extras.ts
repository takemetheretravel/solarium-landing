/**
 * REGRAS DE EXIBIÇÃO E MONTAGEM DE EXTRAS — puras, sem I/O.
 *
 * A disponibilidade da noite adjacente é consultada fora e injetada aqui como
 * booleano. Nunca exibir um extra e recusá-lo depois no draft.
 */

import {
  EXTRAS,
  ExtraConfig,
  getExtra,
  precoExtra,
  precoMenuOperacional,
  JANELA_CANCELAMENTO_EXTRAS_DIAS,
  MAX_QTD_POR_EXTRA,
  PacoteV2,
} from "@/config/precos-e-extras";
import { ItemPreco, diasAte, extraNaoReembolsavel } from "./pacotes";

/** Noite que o extra operacional bloqueia. */
export function noiteBloqueada(
  extraId: "early_checkin" | "late_checkout",
  checkin: string,
  checkout: string,
): string {
  if (extraId === "late_checkout") return checkout;
  const d = new Date(checkin + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ehFimDeSemana(dataISO: string): boolean {
  const dow = new Date(dataISO + "T12:00:00").getDay();
  return dow === 5 || dow === 6;
}

/**
 * Preço de um item operacional dentro de um pacote — idêntico ao do fluxo avulso.
 *
 * Só a noite bloqueada decide, e só sexta e sábado valem fim de semana. Check-out
 * no domingo (Fim de Semana Completo, Feriado qui–dom) e na segunda (Feriado
 * sex–seg) contam o late check-out por tabela de semana.
 */
export function precoOperacionalNoPacote(
  propertySlug: string,
  extraId: "early_checkin" | "late_checkout",
  checkin: string,
  checkout: string,
): number {
  const noite = noiteBloqueada(extraId, checkin, checkout);
  return precoMenuOperacional(propertySlug, extraId, ehFimDeSemana(noite));
}

export type ContextoExibicao = {
  checkin: string;
  checkout: string;
  hoje: string;
  /** Por extraId operacional: a noite que ele bloqueia está livre? */
  noitesLivres: Record<string, boolean>;
};

export type ExtraExibivel = {
  extra: ExtraConfig;
  precoUnitario: number;
  /** Aviso de não reembolsável, exibido no item e no resumo. */
  naoReembolsavel: boolean;
  maxQtd: number;
};

/**
 * Extras que podem ser exibidos ao cliente. Some da lista o que:
 *  - exige noite adjacente livre e ela está ocupada;
 *  - tem antecedência mínima e o check-in já está dentro dessa janela.
 */
export function extrasExibiveis(
  propertySlug: string,
  ctx: ContextoExibicao,
  catalogo: ExtraConfig[] = EXTRAS,
): ExtraExibivel[] {
  const diasAteCheckin = diasAte(ctx.hoje, ctx.checkin);

  return catalogo
    .filter((extra) => {
      if (extra.exigeNoiteLivre && ctx.noitesLivres[extra.id] !== true) return false;
      if (
        extra.antecedenciaMinimaDias !== undefined &&
        diasAteCheckin < extra.antecedenciaMinimaDias
      ) {
        return false;
      }
      return true;
    })
    .map((extra) => ({
      extra,
      precoUnitario: precoUnitarioDe(extra, propertySlug, ctx),
      naoReembolsavel: extraNaoReembolsavel(ctx.checkin, JANELA_CANCELAMENTO_EXTRAS_DIAS, ctx.hoje),
      maxQtd: extra.controle === "on_off" ? 1 : MAX_QTD_POR_EXTRA,
    }));
}

function precoUnitarioDe(
  extra: ExtraConfig,
  propertySlug: string,
  ctx: ContextoExibicao,
): number {
  if (extra.id === "early_checkin" || extra.id === "late_checkout") {
    return precoOperacionalNoPacote(propertySlug, extra.id, ctx.checkin, ctx.checkout);
  }
  return precoExtra(extra);
}

/** Seleção do cliente: quantidade por id de extra. */
export type SelecaoExtras = Record<string, number>;

/**
 * Monta as linhas de preço de um pacote: os itens inclusos (a preço cheio de menu,
 * exceto os removidos) mais os extras opcionais escolhidos.
 *
 * Itens informativos nunca entram — a cobrança deles acontece em outro lugar.
 */
export function montarItens(params: {
  pacote: PacoteV2 | null;
  propertySlug: string;
  checkin: string;
  checkout: string;
  /** Ids de itens inclusos removíveis que o cliente REMOVEU. */
  removidos: string[];
  /** Extras opcionais escolhidos, por id. */
  selecao: SelecaoExtras;
}): ItemPreco[] {
  const { pacote, propertySlug, checkin, checkout, removidos, selecao } = params;
  const itens: ItemPreco[] = [];
  const jaIncluso = new Set<string>();

  for (const incluso of pacote?.inclusos ?? []) {
    if (incluso.removivel && removidos.includes(incluso.extraId)) continue;
    const extra = getExtra(incluso.extraId);
    if (!extra || extra.informativo) continue;
    jaIncluso.add(extra.id);
    itens.push(
      linha(extra, incluso.qtd, precoDoItem(extra, propertySlug, checkin, checkout), true),
    );
  }

  for (const [id, qtd] of Object.entries(selecao)) {
    if (qtd <= 0) continue;
    if (jaIncluso.has(id)) continue; // não duplicar o que o pacote já traz
    const extra = getExtra(id);
    if (!extra || extra.informativo) continue;
    const q = Math.min(Math.floor(qtd), extra.controle === "on_off" ? 1 : MAX_QTD_POR_EXTRA);
    itens.push(linha(extra, q, precoDoItem(extra, propertySlug, checkin, checkout), false));
  }

  return itens;
}

function precoDoItem(
  extra: ExtraConfig,
  propertySlug: string,
  checkin: string,
  checkout: string,
): number {
  if (extra.id === "early_checkin" || extra.id === "late_checkout") {
    return precoOperacionalNoPacote(propertySlug, extra.id, checkin, checkout);
  }
  return precoExtra(extra);
}

function linha(extra: ExtraConfig, qtd: number, precoUnitario: number, incluso: boolean): ItemPreco {
  return {
    extraId: extra.id,
    nome: extra.nome,
    qtd,
    precoUnitario,
    total: precoUnitario * qtd,
    entraNaBase: extra.entraNaBase,
    incluso,
  };
}

/** Late check-out ativo na reserva — incluso e não removido, ou contratado à parte. */
export function lateCheckoutAtivo(itens: ItemPreco[]): boolean {
  return itens.some((i) => i.extraId === "late_checkout" && i.qtd > 0);
}

// ---------------------------------------------------------------------------
// VALIDAÇÃO DE DATAS DO PACOTE
// ---------------------------------------------------------------------------

const NOME_DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export type ValidacaoDatas =
  | { valido: true }
  | { valido: false; motivo: string; alternativa?: "avulso" | "outro-pacote" };

/**
 * Bloqueia a seleção ANTES do CTA. Nunca aceitar datas incompatíveis e recusar
 * depois no draft — o cliente já teria preenchido tudo.
 */
export function validarDatasPacote(
  pacote: PacoteV2,
  checkin: string,
  checkout: string,
  contemFeriado: boolean,
): ValidacaoDatas {
  const noites = Math.round(
    (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
      86400000,
  );

  if (noites <= 0) return { valido: false, motivo: "O check-out precisa ser depois do check-in." };

  if (noites < pacote.noitesMin) {
    return {
      valido: false,
      motivo:
        pacote.noitesMax === pacote.noitesMin
          ? `Este pacote é de exatamente ${pacote.noitesMin} noites.`
          : `Este pacote começa em ${pacote.noitesMin} noites.`,
      alternativa: "outro-pacote",
    };
  }
  if (pacote.noitesMax !== null && noites > pacote.noitesMax) {
    return {
      valido: false,
      motivo: `Este pacote é de exatamente ${pacote.noitesMax} noites.`,
      alternativa: "avulso",
    };
  }

  const dowIn = new Date(checkin + "T12:00:00").getDay();
  if (pacote.checkinDows && !pacote.checkinDows.includes(dowIn)) {
    const dias = pacote.checkinDows.map((d) => NOME_DOW[d]).join(" ou ");
    return { valido: false, motivo: `A chegada deste pacote é ${dias}.`, alternativa: "outro-pacote" };
  }

  const dowOut = new Date(checkout + "T12:00:00").getDay();
  if (pacote.checkoutDows && !pacote.checkoutDows.includes(dowOut)) {
    const dias = pacote.checkoutDows.map((d) => NOME_DOW[d]).join(" ou ");
    return { valido: false, motivo: `A saída deste pacote é ${dias}.`, alternativa: "outro-pacote" };
  }

  if (pacote.exigeFeriado && !contemFeriado) {
    return {
      valido: false,
      motivo: "Este pacote vale para estadias que incluem um feriado nacional.",
      alternativa: "outro-pacote",
    };
  }

  return { valido: true };
}
