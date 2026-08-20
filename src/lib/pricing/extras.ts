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

/** Estadia de fim de semana: alguma das noites cai em sexta ou sábado. */
export function estadiaDeFimDeSemana(checkin: string, checkout: string): boolean {
  const d = new Date(checkin + "T12:00:00");
  const fim = new Date(checkout + "T12:00:00");
  while (d < fim) {
    const dow = d.getDay();
    if (dow === 5 || dow === 6) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

/**
 * Preço de MENU de um item operacional: o que o produto anuncia.
 *
 * Acompanha o tipo de estadia, não a noite bloqueada. Um Dois Casais de segunda a
 * quarta anuncia o late por tabela de semana; o mesmo pacote na sexta anuncia por
 * fim de semana.
 */
export function precoMenuDoItem(
  propertySlug: string,
  extraId: "early_checkin" | "late_checkout",
  checkin: string,
  checkout: string,
): number {
  return precoMenuOperacional(propertySlug, extraId, estadiaDeFimDeSemana(checkin, checkout));
}

/**
 * Preço REAL: o que o fluxo avulso cobraria, com o corte das noites de baixa
 * demanda. Só a noite efetivamente bloqueada decide.
 *
 * A diferença para o de menu vira desconto fixo, fora da base progressiva.
 */
export function precoRealDoItem(
  propertySlug: string,
  extraId: "early_checkin" | "late_checkout",
  checkin: string,
  checkout: string,
): number {
  const noite = noiteBloqueada(extraId, checkin, checkout);
  return precoMenuOperacional(propertySlug, extraId, ehFimDeSemana(noite));
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
  return precoRealDoItem(propertySlug, extraId, checkin, checkout);
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
  /**
   * Preenchido quando o item existe mas não pode ser contratado nestas datas.
   *
   * Antes esses itens sumiam da lista sem explicação — no Dois Casais, que exige
   * a noite livre nas DUAS casas, o check-in antecipado desaparecia e ninguém
   * sabia por quê. Sumir em silêncio parece bug; dizer o motivo é informação.
   */
  motivoIndisponivel?: string;
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
      // Informativo não tem controle nem valor: o custo já aparece no resumo de
      // preço, e repetir aqui só confunde.
      if (extra.informativo) return false;
      // Antecedência mínima: aqui o item some mesmo — não há o que oferecer.
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
      motivoIndisponivel:
        extra.exigeNoiteLivre && ctx.noitesLivres[extra.id] !== true
          ? extra.exigeNoiteLivre === "anterior"
            ? "A noite anterior à chegada já está reservada."
            : "A noite seguinte à saída já está reservada."
          : undefined,
    }));
}

/**
 * Preço EXIBIDO na lista de extras — o mesmo de menu que aparece na linha de
 * preço. Eram dois caminhos: a lista mostrava o valor operacional (550) e a
 * linha, o de menu (850), para o mesmo item.
 *
 * O desconto até o valor operacional aparece no detalhamento, como
 * "Ajuste do check-out estendido". Nenhum total muda.
 */
function precoUnitarioDe(
  extra: ExtraConfig,
  propertySlug: string,
  ctx: ContextoExibicao,
): number {
  if (extra.id === "early_checkin" || extra.id === "late_checkout") {
    return precoMenuDoItem(propertySlug, extra.id, ctx.checkin, ctx.checkout);
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

  const dowCheckout = new Date(checkout + "T12:00:00").getDay();

  for (const incluso of pacote?.inclusos ?? []) {
    if (incluso.removivel && removidos.includes(incluso.extraId)) continue;
    // Incluso condicionado à saída: entra e sai sozinho quando o cliente muda a
    // data, no mesmo recálculo. É assim que o late do Final de Ano acompanha o
    // domingo sem o cliente precisar mexer em nada.
    if (incluso.somenteCheckoutDows && !incluso.somenteCheckoutDows.includes(dowCheckout)) {
      continue;
    }
    const extra = getExtra(incluso.extraId);
    if (!extra || extra.informativo) continue;
    jaIncluso.add(extra.id);
    itens.push(
      linha(
        extra,
        incluso.qtd,
        precoDoItem(extra, propertySlug, checkin, checkout),
        true,
        valorNaBaseDoItem(extra, propertySlug, checkin, checkout),
      ),
    );
  }

  for (const [id, qtd] of Object.entries(selecao)) {
    if (qtd <= 0) continue;
    if (jaIncluso.has(id)) continue; // não duplicar o que o pacote já traz
    const extra = getExtra(id);
    if (!extra || extra.informativo) continue;
    const q = Math.min(Math.floor(qtd), extra.controle === "on_off" ? 1 : MAX_QTD_POR_EXTRA);
    itens.push(
      linha(
        extra,
        q,
        precoDoItem(extra, propertySlug, checkin, checkout),
        false,
        valorNaBaseDoItem(extra, propertySlug, checkin, checkout),
      ),
    );
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
    return precoMenuDoItem(propertySlug, extra.id, checkin, checkout);
  }
  return precoExtra(extra);
}

function linha(
  extra: ExtraConfig,
  qtd: number,
  precoUnitario: number,
  incluso: boolean,
  valorNaBaseUnitario?: number,
): ItemPreco {
  return {
    extraId: extra.id,
    nome: extra.nome,
    qtd,
    precoUnitario,
    total: precoUnitario * qtd,
    entraNaBase: extra.entraNaBase,
    incluso,
    ...(valorNaBaseUnitario !== undefined
      ? { valorNaBase: valorNaBaseUnitario * qtd }
      : {}),
  };
}

/**
 * Itens operacionais são exibidos ao preço de menu de fim de semana, mas só o
 * custo operacional real da noite bloqueada entra na base do progressivo.
 * A diferença vira desconto fixo — aparece para o cliente como desconto, não
 * some da conta.
 */
function valorNaBaseDoItem(
  extra: ExtraConfig,
  propertySlug: string,
  checkin: string,
  checkout: string,
): number | undefined {
  if (extra.id !== "early_checkin" && extra.id !== "late_checkout") return undefined;
  return precoRealDoItem(propertySlug, extra.id, checkin, checkout);
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
  // Janela sazonal de check-in (MM-DD), independente do ano. Atravessa a virada
  // quando `de` > `ate`.
  if (pacote.janelaCheckin) {
    const md = checkin.slice(5); // MM-DD
    const { de, ate } = pacote.janelaCheckin;
    const dentro = de <= ate ? md >= de && md <= ate : md >= de || md <= ate;
    if (!dentro) {
      return {
        valido: false,
        motivo: "Este pacote vale para chegadas entre 21 e 30 de dezembro.",
        alternativa: "avulso",
      };
    }
  }

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

// ---------------------------------------------------------------------------
// PONTE COM O CHECKOUT
// ---------------------------------------------------------------------------

/**
 * Extras de serviço do catálogo V2, no formato que o checkout já consome.
 *
 * Exclui os informativos (a cobrança acontece em outro lugar) e os operacionais
 * — early e late têm UI própria no checkout, com checagem de noite adjacente, e
 * usam os mesmos ids nos dois catálogos.
 */
export function extrasServicoV2(): {
  id: string;
  label: string;
  unitPrice: number;
  restriction?: string;
}[] {
  return EXTRAS.filter((e) => !e.informativo && !e.entraNaBase).map((e) => ({
    id: e.id,
    label: e.nome,
    unitPrice: precoExtra(e),
    restriction: e.observacao,
  }));
}

/**
 * Resolve um id de extra de serviço para o recálculo server-side.
 *
 * Aceita os ids do catálogo V2. O preço NUNCA vem do cliente — sai daqui.
 */
export function resolverExtraServicoV2(
  id: string,
): { id: string; label: string; preco: number; nota?: string; prazoFornecedorDias?: number } | null {
  const extra = getExtra(id);
  if (!extra || extra.informativo || extra.entraNaBase) return null;
  return {
    id: extra.id,
    label: extra.nome,
    preco: precoExtra(extra),
    nota: extra.notaInterna,
    prazoFornecedorDias: extra.prazoFornecedorDias,
  };
}


// ---------------------------------------------------------------------------
// INCLUSOS ATIVOS — defesa contra cobrança dupla
// ---------------------------------------------------------------------------

/**
 * Ids que o pacote já entrega e que o cliente NÃO removeu.
 *
 * Fonte única para as três defesas: a interface não oferece, o checkout não
 * lista, e o draft rejeita. Um item incluso comprado de novo é dinheiro cobrado
 * a maior por um serviço que o hóspede já tinha.
 */
export function inclusosAtivos(
  pacote: PacoteV2 | null | undefined,
  removidos: string[] = [],
): string[] {
  if (!pacote) return [];
  return pacote.inclusos
    .filter((i) => !(i.removivel && removidos.includes(i.extraId)))
    .map((i) => i.extraId);
}

/** Ids duplicados entre a seleção do cliente e o que o pacote já inclui. */
export function extrasDuplicados(
  pacote: PacoteV2 | null | undefined,
  removidos: string[],
  idsSelecionados: string[],
): string[] {
  const jaIncluso = new Set(inclusosAtivos(pacote, removidos));
  return idsSelecionados.filter((id) => jaIncluso.has(id));
}
