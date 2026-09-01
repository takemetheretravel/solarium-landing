/**
 * Decomposição financeira da reserva para a Hostaway.
 *
 * Hoje a equipe lança extras e descontos à mão no PMS para o orçamento bater
 * com o que foi cobrado. Este módulo monta essa decomposição a partir do draft,
 * que já tem tudo revalidado server-side.
 *
 * REGRA INEGOCIÁVEL: a soma das linhas tem que fechar EXATAMENTE com o valor
 * cobrado do hóspede. Divergência de centavo não é arredondada nem "ajustada" —
 * a decomposição é descartada e o caso vai para conferência humana. Um orçamento
 * que não fecha é pior que um orçamento ausente: ele parece certo.
 *
 * ESTADO: `reservationFees` existe na API da Hostaway, mas o schema completo não
 * é publicado (a doc remete ao suporte). Por isso o envio nasce atrás de
 * `HOSTAWAY_ENVIAR_DECOMPOSICAO`, desligado por padrão — o cálculo e a
 * reconciliação rodam e são logados, sem alterar o que já funciona.
 */

/** Uma linha do orçamento. `amount` positivo cobra, negativo desconta. */
export type LinhaFinanceira = {
  name: string;
  amount: number;
  /** Classificação da Hostaway: accommodation, other, tax, commissions. */
  type: "accommodation" | "other" | "tax" | "commissions";
};

export type DecomposicaoFinanceira =
  | { ok: true; linhas: LinhaFinanceira[]; soma: number; total: number }
  | { ok: false; motivo: string; linhas: LinhaFinanceira[]; soma: number; total: number };

/** Centavos inteiros — comparar float direto é o caminho para o erro de 1 centavo. */
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

type DraftFinanceiro = {
  totalPrice: number;
  finalTotal: number;
  subtotal?: number;
  couponDiscount?: number;
  couponCode?: string;
  pixDiscount?: number;
  serviceExtras?: { label: string; qty: number; price: number }[];
  opExtras?: { label: string; price: number }[];
  pacoteItens?: { nome: string; qtd: number; total: number; incluso: boolean }[];
  pacoteNome?: string;
  descontoProgressivo?: number;
  bonusSaida?: number;
};

/**
 * Monta as linhas e confere se elas fecham com `valorCobrado`.
 *
 * `valorCobrado` é o valor REAL debitado (com juros de parcelamento, quando
 * houver) — não o `finalTotal` do draft, que é o valor à vista.
 */
export function montarDecomposicao(
  draft: DraftFinanceiro,
  valorCobrado: number,
): DecomposicaoFinanceira {
  const linhas: LinhaFinanceira[] = [];

  // 1) Estadia: a tarifa da Hostaway, antes de qualquer extra ou desconto.
  const estadia = draft.totalPrice;
  if (centavos(estadia) !== 0) {
    linhas.push({ name: "Estadia", amount: estadia, type: "accommodation" });
  }

  // 2) Itens do pacote que NÃO estão inclusos (os inclusos já vivem na estadia
  //    ou no desconto; cobrá-los de novo duplicaria a linha).
  for (const item of draft.pacoteItens ?? []) {
    if (item.incluso) continue;
    if (centavos(item.total) === 0) continue;
    const qtd = item.qtd > 1 ? ` x${item.qtd}` : "";
    linhas.push({ name: `${item.nome}${qtd}`, amount: item.total, type: "other" });
  }

  // 3) Extras de serviço e operacionais.
  for (const e of draft.serviceExtras ?? []) {
    if (centavos(e.price) === 0) continue;
    const qtd = e.qty > 1 ? ` x${e.qty}` : "";
    linhas.push({ name: `${e.label}${qtd}`, amount: e.price, type: "other" });
  }
  for (const e of draft.opExtras ?? []) {
    if (centavos(e.price) === 0) continue;
    linhas.push({ name: e.label, amount: e.price, type: "other" });
  }

  // 4) Descontos, como linhas negativas.
  if (draft.descontoProgressivo && draft.descontoProgressivo > 0) {
    linhas.push({
      name: draft.pacoteNome ? `Desconto ${draft.pacoteNome}` : "Desconto do pacote",
      amount: -draft.descontoProgressivo,
      type: "other",
    });
  }
  if (draft.bonusSaida && draft.bonusSaida > 0) {
    linhas.push({ name: "Bônus", amount: -draft.bonusSaida, type: "other" });
  }
  if (draft.couponDiscount && draft.couponDiscount > 0) {
    linhas.push({
      name: draft.couponCode ? `Cupom ${draft.couponCode}` : "Cupom",
      amount: -draft.couponDiscount,
      type: "other",
    });
  }
  if (draft.pixDiscount && draft.pixDiscount > 0) {
    linhas.push({ name: "Desconto Pix", amount: -draft.pixDiscount, type: "other" });
  }

  // 5) Juros de parcelamento: a diferença entre o cobrado e o valor à vista.
  //    Sem esta linha, um parcelamento com juros nunca fecharia.
  const juros = centavos(valorCobrado) - centavos(draft.finalTotal);
  if (juros > 0) {
    linhas.push({ name: "Juros de parcelamento", amount: juros / 100, type: "other" });
  }

  const somaCent = linhas.reduce((s, l) => s + centavos(l.amount), 0);
  const alvoCent = centavos(valorCobrado);
  const soma = somaCent / 100;

  if (somaCent !== alvoCent) {
    return {
      ok: false,
      motivo: `soma das linhas (${soma.toFixed(2)}) difere do valor cobrado (${valorCobrado.toFixed(2)}) em ${((somaCent - alvoCent) / 100).toFixed(2)}`,
      linhas,
      soma,
      total: valorCobrado,
    };
  }

  return { ok: true, linhas, soma, total: valorCobrado };
}

/** A flag que libera o envio. Desligada, só calcula e loga. */
export function enviarDecomposicaoAtivo(): boolean {
  return process.env.HOSTAWAY_ENVIAR_DECOMPOSICAO === "true";
}

/**
 * Calcula, loga o veredito e devolve as linhas só quando elas fecham E a flag
 * está ligada. Em qualquer outro caso devolve `null` — a reserva segue com
 * `totalPrice`, que é o comportamento que já funciona hoje.
 */
export function decomposicaoParaEnvio(
  draft: DraftFinanceiro,
  valorCobrado: number,
  draftId: string,
): LinhaFinanceira[] | null {
  const r = montarDecomposicao(draft, valorCobrado);

  if (!r.ok) {
    // Nível error de propósito: orçamento que não fecha é conferência humana.
    console.error(
      "[Hostaway:financeiro] DECOMPOSICAO NAO FECHA — nao enviada " +
        JSON.stringify({ draftId, motivo: r.motivo, soma: r.soma, cobrado: r.total }),
    );
    return null;
  }

  console.log(
    "[Hostaway:financeiro] decomposicao confere " +
      JSON.stringify({
        draftId,
        linhas: r.linhas.length,
        total: r.total,
        enviando: enviarDecomposicaoAtivo(),
      }),
  );

  return enviarDecomposicaoAtivo() ? r.linhas : null;
}
