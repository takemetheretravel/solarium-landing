import { describe, it, expect } from "vitest";
import {
  calcularPacote,
  avaliarBonusSaida,
  aplicarPix,
  pisoDezena,
  economiaVsAvulso,
  totalAvulsoEquivalente,
  melhorTotal,
  dataLimiteCancelamentoExtras,
  extraNaoReembolsavel,
  EntradaMotor,
  ItemPreco,
} from "./pacotes";
import { montarItens, extrasExibiveis, lateCheckoutAtivo } from "./extras";
import {
  taxaProgressiva,
  estadiaContemFeriado,
  feriadosNaEstadia,
  ANO_FINAL_FERIADOS,
  JANELA_CANCELAMENTO_EXTRAS_DIAS,
  getPacoteV2,
  EXTRAS,
  bonusSaidaPara,
} from "@/config/precos-e-extras";

// ---------------------------------------------------------------------------
// Helpers de montagem — mantêm os golden tests legíveis
// ---------------------------------------------------------------------------

const BONUS = 350;

function item(
  extraId: string,
  precoUnitario: number,
  entraNaBase: boolean,
  qtd = 1,
): ItemPreco {
  return {
    extraId,
    nome: extraId,
    qtd,
    precoUnitario,
    total: precoUnitario * qtd,
    entraNaBase,
    incluso: true,
  };
}

const late = (v = 550) => item("late_checkout", v, true);
const cafe = (v = 180) => item("cesta_cafecafe", v, false);
const tabua = () => item("tabua_frios", 310, false);

function entrada(noites: number, hostawayTotal: number, itens: ItemPreco[], bonus = 0): EntradaMotor {
  return { noites, hostawayTotal, itens, bonusSaida: bonus };
}

/**
 * Monta os itens pelo MESMO caminho que o servidor usa. Os golden tests precisam
 * exercitar `montarItens`/`precoOperacionalNoPacote` — construir as linhas à mão
 * esconderia justamente uma divergência de preço de menu.
 */
function itensReais(
  slug: string,
  propertySlug: string,
  checkin: string,
  checkout: string,
  removidos: string[] = [],
  selecao: Record<string, number> = {},
): ItemPreco[] {
  return montarItens({
    pacote: getPacoteV2(slug) ?? null,
    propertySlug,
    checkin,
    checkout,
    removidos,
    selecao,
  });
}

// Datas reais usadas nos golden tests
const FDS = { checkin: "2026-09-11", checkout: "2026-09-13" }; // sexta → domingo
const FERIADO_QUI_DOM = { checkin: "2026-06-04", checkout: "2026-06-07" }; // Corpus Christi
const FERIADO_SEX_SEG = { checkin: "2026-09-04", checkout: "2026-09-07" }; // Independência

// ---------------------------------------------------------------------------
// TAXA PROGRESSIVA
// ---------------------------------------------------------------------------

describe("taxa progressiva", () => {
  it("segue a tabela 1→0% · 2→8% · 3-4→12% · 5+→17%", () => {
    expect(taxaProgressiva(1)).toBe(0);
    expect(taxaProgressiva(2)).toBe(0.08);
    expect(taxaProgressiva(3)).toBe(0.12);
    expect(taxaProgressiva(4)).toBe(0.12);
    expect(taxaProgressiva(5)).toBe(0.17);
    expect(taxaProgressiva(9)).toBe(0.17);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN TESTS — valores fixos, revisão 2.1 com a base de desconto corrigida
// ---------------------------------------------------------------------------

describe("preço de menu dos itens operacionais", () => {
  it("late check-out do FDS (saída no domingo) vale tabela de semana, R$ 550", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(550);
  });

  it("late check-out do Feriado sex-seg (saída na segunda) também vale 550", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_SEX_SEG.checkin,
      FERIADO_SEX_SEG.checkout,
    );
    expect(itens.find((i) => i.extraId === "late_checkout")?.total).toBe(550);
  });

  it("Dois Casais mantém a diferença fds/semana: saída no sábado vale 1.600", () => {
    // qui 10/09 → sáb 12/09: a noite bloqueada é sábado
    const itens = itensReais("dois-casais", "solarium-completo", "2026-09-10", "2026-09-12");
    expect(itens.find((i) => i.extraId === "late_checkout")?.total).toBe(1600);
  });

  it("Dois Casais com saída no domingo vale tabela de semana, 1.000", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout);
    expect(itens.find((i) => i.extraId === "late_checkout")?.total).toBe(1000);
  });
});

describe("golden: Fim de Semana Completo", () => {
  it("baixa temporada — base 3.950 · desconto 666 · total 3.460", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.baseDesconto).toBe(3950);
    expect(r.subtotal).toBe(4130);
    expect(r.descontoProgressivo).toBe(316);
    expect(r.bonusSaida).toBe(350);
    expect(r.descontoTotal).toBe(666);
    expect(r.total).toBe(3460);
  });

  it("alta temporada — base 4.250 · desconto 690 · total 3.740", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3700, itens, BONUS));
    expect(r.baseDesconto).toBe(4250);
    expect(r.descontoProgressivo).toBe(340);
    expect(r.descontoTotal).toBe(690);
    expect(r.total).toBe(3740);
  });

  it("sem café, baixa — base 3.950 · desconto 666 · total 3.280, bônus mantido", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout, [
      "cesta_cafecafe",
    ]);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.baseDesconto).toBe(3950);
    expect(r.subtotal).toBe(3950);
    expect(r.descontoTotal).toBe(666);
    expect(r.bonusSaida).toBe(350);
    expect(r.total).toBe(3280);
  });
});

describe("golden: Feriado na Serra", () => {
  it("qui-dom com bônus — base 7.000 · desconto 1.190 · total 5.990", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_QUI_DOM.checkin,
      FERIADO_QUI_DOM.checkout,
    );
    const r = calcularPacote(entrada(3, 6450, itens, BONUS));
    expect(r.baseDesconto).toBe(7000);
    expect(r.subtotal).toBe(7180);
    expect(r.descontoProgressivo).toBe(840);
    expect(r.descontoTotal).toBe(1190);
    expect(r.total).toBe(5990);
  });

  it("sex-seg sem bônus (noite seguinte ocupada) — base 7.000 · desconto 840 · total 6.340", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_SEX_SEG.checkin,
      FERIADO_SEX_SEG.checkout,
    );
    const r = calcularPacote(entrada(3, 6450, itens, 0));
    expect(r.baseDesconto).toBe(7000);
    expect(r.descontoProgressivo).toBe(840);
    expect(r.descontoTotal).toBe(840);
    expect(r.total).toBe(6340);
  });

  it("sex-seg COM bônus (late ativo, noite seguinte livre, feriado na estadia) — total 5.990", () => {
    const bonus = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: true,
      checkout: FERIADO_SEX_SEG.checkout,
      contemFeriado: estadiaContemFeriado(FERIADO_SEX_SEG.checkin, FERIADO_SEX_SEG.checkout),
      valorBonus: BONUS,
    });
    expect(bonus.aplicavel).toBe(true);

    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_SEX_SEG.checkin,
      FERIADO_SEX_SEG.checkout,
    );
    const r = calcularPacote(entrada(3, 6450, itens, bonus.valor));
    expect(r.total).toBe(5990);
  });
});

describe("golden: economia frente à contratação avulsa", () => {
  it("FDS Completo baixa — avulso 3.858, economia R$ 398, calculada e não hardcoded", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const e = entrada(2, 3400, itens, BONUS);
    const r = calcularPacote(e);

    // 3.128 (diárias com 8%) + 550 (late) + 180 (cesta)
    expect(totalAvulsoEquivalente(e)).toBe(3858);
    expect(economiaVsAvulso(e, r.total)).toBe(398);
  });

  it("os dois lados da economia usam o mesmo preço de menu do late check-out", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const e = entrada(2, 3400, itens, BONUS);
    const lateNoPacote = itens.find((i) => i.extraId === "late_checkout")?.total ?? 0;

    // O avulso soma os MESMOS itens a preço cheio sobre a estadia com desconto.
    expect(totalAvulsoEquivalente(e)).toBe(
      Math.round(3400 * 0.92) + lateNoPacote + 180,
    );
  });

  it("nunca devolve economia negativa", () => {
    const e = entrada(1, 1000, [cafe()], 0);
    expect(economiaVsAvulso(e, 99999)).toBe(0);
  });
});

describe("golden: extras fora da base", () => {
  it("tábua de frios aumenta o total em exatamente R$ 310 e não altera a linha de desconto", () => {
    const semTabua = calcularPacote(entrada(2, 3400, [late(), cafe()], BONUS));
    const comTabua = calcularPacote(entrada(2, 3400, [late(), cafe(), tabua()], BONUS));

    expect(comTabua.total - semTabua.total).toBe(310);
    expect(comTabua.descontoTotal).toBe(semTabua.descontoTotal);
    expect(comTabua.baseDesconto).toBe(semTabua.baseDesconto);
  });

  it("cestas, massagem, decoração, fondues e lenha ficam fora da base", () => {
    const foraDaBase = [
      "cesta_cafecafe",
      "cesta_diluia",
      "cesta_dani",
      "tabua_frios",
      "massagem",
      "decoracao",
      "fondue_queijo",
      "fondue_chocolate",
      "lenha",
    ];
    for (const id of foraDaBase) {
      expect(EXTRAS.find((e) => e.id === id)?.entraNaBase).toBe(false);
    }
    for (const id of ["early_checkin", "late_checkout"]) {
      expect(EXTRAS.find((e) => e.id === id)?.entraNaBase).toBe(true);
    }
  });
});

describe("golden: pessoa adicional", () => {
  it("duas pessoas a mais alteram a linha de desconto, porque entram na base", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const base = calcularPacote(entrada(2, 3400, itens, BONUS));
    // 2 pessoas × R$ 100 (Hostaway) × 2 noites = 400, já dentro do total Hostaway
    const comPessoas = calcularPacote(entrada(2, 3800, itens, BONUS));

    expect(comPessoas.baseDesconto).toBe(4350);
    expect(comPessoas.descontoProgressivo).toBe(348);
    expect(comPessoas.descontoTotal).toBe(698);
    expect(comPessoas.descontoTotal).not.toBe(base.descontoTotal);
    expect(comPessoas.total).toBe(3830);
  });

  it("é informativo no catálogo e não tem preço próprio no repositório", () => {
    const pa = EXTRAS.find((e) => e.id === "pessoa_adicional");
    expect(pa?.informativo).toBe(true);
    expect(pa?.preco).toBeNull();
  });

  it("nunca entra como linha do subtotal, mesmo se selecionado", () => {
    const itens = montarItens({
      pacote: getPacoteV2("fim-de-semana-completo") ?? null,
      propertySlug: "solarium-1",
      checkin: "2026-09-11",
      checkout: "2026-09-13",
      removidos: [],
      selecao: { pessoa_adicional: 2 },
    });
    expect(itens.some((i) => i.extraId === "pessoa_adicional")).toBe(false);
  });
});

describe("golden: Dois Casais, Uma Vista", () => {
  it("late removido — o bônus sai junto, no mesmo recálculo", () => {
    const comLate = montarItens({
      pacote: getPacoteV2("dois-casais") ?? null,
      propertySlug: "solarium-completo",
      checkin: "2026-09-11",
      checkout: "2026-09-13",
      removidos: [],
      selecao: {},
    });
    const semLate = montarItens({
      pacote: getPacoteV2("dois-casais") ?? null,
      propertySlug: "solarium-completo",
      checkin: "2026-09-11",
      checkout: "2026-09-13",
      removidos: ["late_checkout"],
      selecao: {},
    });

    expect(lateCheckoutAtivo(comLate)).toBe(true);
    expect(lateCheckoutAtivo(semLate)).toBe(false);

    const bonusCom = avaliarBonusSaida({
      lateAtivo: lateCheckoutAtivo(comLate),
      noiteSeguinteLivre: true,
      checkout: "2026-09-13",
      contemFeriado: false,
      valorBonus: BONUS,
    });
    const bonusSem = avaliarBonusSaida({
      lateAtivo: lateCheckoutAtivo(semLate),
      noiteSeguinteLivre: true,
      checkout: "2026-09-13",
      contemFeriado: false,
      valorBonus: BONUS,
    });

    expect(bonusCom.valor).toBe(350);
    expect(bonusSem.valor).toBe(0);

    const r = calcularPacote(entrada(2, 3900, semLate, bonusSem.valor));
    expect(r.baseDesconto).toBe(3900);
    expect(r.descontoTotal).toBe(312);
    expect(r.total).toBe(3580);
  });

  it("2 noites usam a taxa de 8% da tabela, sem piso artificial", () => {
    const r = calcularPacote(entrada(2, 3900, [item("late_checkout", 1600, true)], BONUS));
    expect(r.taxa).toBe(0.08);
    expect(r.baseDesconto).toBe(5500);
    expect(r.descontoProgressivo).toBe(440);
    expect(r.total).toBe(4710);
  });

  it("o bônus do Completo é R$ 350, não R$ 700", () => {
    expect(bonusSaidaPara("solarium-completo")).toBe(350);
    expect(bonusSaidaPara("solarium-1")).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// BÔNUS DE SAÍDA
// ---------------------------------------------------------------------------

describe("bônus de saída", () => {
  it("sem late check-out, nunca há bônus — em nenhuma hipótese", () => {
    for (const checkout of ["2026-09-13", "2026-09-07"]) {
      const r = avaliarBonusSaida({
        lateAtivo: false,
        noiteSeguinteLivre: true,
        checkout,
        contemFeriado: true,
        valorBonus: BONUS,
      });
      expect(r.aplicavel).toBe(false);
      expect(r.valor).toBe(0);
    }
  });

  it("noite seguinte ocupada bloqueia o bônus", () => {
    const r = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: false,
      checkout: "2026-09-13",
      contemFeriado: false,
      valorBonus: BONUS,
    });
    expect(r.aplicavel).toBe(false);
  });

  it("aplica em check-out no domingo", () => {
    const r = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: true,
      checkout: "2026-09-13", // domingo
      contemFeriado: false,
      valorBonus: BONUS,
    });
    expect(r.aplicavel).toBe(true);
    expect(r.valor).toBe(350);
  });

  it("aplica em check-out na segunda quando a estadia contém feriado", () => {
    const r = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: true,
      checkout: "2026-09-07", // segunda, Independência
      contemFeriado: true,
      valorBonus: BONUS,
    });
    expect(r.aplicavel).toBe(true);
  });

  it("NÃO aplica em check-out na segunda sem feriado na estadia", () => {
    const r = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: true,
      checkout: "2026-09-14", // segunda comum
      contemFeriado: false,
      valorBonus: BONUS,
    });
    expect(r.aplicavel).toBe(false);
  });

  it("NÃO aplica em check-out no sábado, nem com feriado", () => {
    const r = avaliarBonusSaida({
      lateAtivo: true,
      noiteSeguinteLivre: true,
      checkout: "2026-09-12", // sábado
      contemFeriado: true,
      valorBonus: BONUS,
    });
    expect(r.aplicavel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ARREDONDAMENTO E PIX
// ---------------------------------------------------------------------------

describe("arredondamento", () => {
  it("piso de dezena arredonda para baixo", () => {
    expect(pisoDezena(3725.6)).toBe(3720);
    expect(pisoDezena(4001.6)).toBe(4000);
    expect(pisoDezena(3740)).toBe(3740);
  });

  it("Pix aplica 3% sobre o total já arredondado e faz novo piso de dezena", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.total).toBe(3460);

    const pix = aplicarPix(r.total);
    expect(pix.total).toBe(3350); // 3.460 × 0,97 = 3.356,20 → 3.350
    expect(pix.desconto).toBe(110);
    expect(Number.isInteger(pix.total)).toBe(true);
  });

  it("o valor exibido e o cobrado são idênticos — total sempre múltiplo de 10", () => {
    const casos: [number, number, ItemPreco[]][] = [
      [2, 3400, [late(), cafe()]],
      [3, 6450, [late(), cafe()]],
      [4, 8123, [late(), cafe(), tabua()]],
      [5, 11077, [late()]],
    ];
    for (const [noites, hostaway, itens] of casos) {
      const r = calcularPacote(entrada(noites, hostaway, itens, BONUS));
      expect(r.total % 10).toBe(0);
      expect(aplicarPix(r.total).total % 10).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// CUMULATIVIDADE
// ---------------------------------------------------------------------------

describe("cumulatividade", () => {
  it("pacote e tarifa promocional nunca somam — vence o menor total", () => {
    expect(melhorTotal(3740, 3500)).toEqual({ total: 3500, origem: "promocional" });
    expect(melhorTotal(3740, 3900)).toEqual({ total: 3740, origem: "pacote" });
    expect(melhorTotal(3740, null)).toEqual({ total: 3740, origem: "pacote" });
  });

  it("progressivo e bônus aparecem somados numa linha só", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.descontoTotal).toBe(r.descontoProgressivo + r.bonusSaida);
    expect(r.descontoTotal).toBe(666);
  });
});

// ---------------------------------------------------------------------------
// CANCELAMENTO DE EXTRAS
// ---------------------------------------------------------------------------

describe("cancelamento de extras — janela de 7 dias a partir do check-in", () => {
  it("check-in a 10 dias: sem aviso, data-limite = check-in menos 7", () => {
    const hoje = "2026-09-01";
    const checkin = "2026-09-11";
    expect(dataLimiteCancelamentoExtras(checkin, JANELA_CANCELAMENTO_EXTRAS_DIAS)).toBe("2026-09-04");
    expect(extraNaoReembolsavel(checkin, JANELA_CANCELAMENTO_EXTRAS_DIAS, hoje)).toBe(false);
  });

  it("check-in a 6 dias: exibe o aviso, e a decoração ainda é oferecida", () => {
    const hoje = "2026-09-01";
    const checkin = "2026-09-07";
    expect(extraNaoReembolsavel(checkin, JANELA_CANCELAMENTO_EXTRAS_DIAS, hoje)).toBe(true);

    const visiveis = extrasExibiveis("solarium-1", {
      checkin,
      checkout: "2026-09-09",
      hoje,
      noitesLivres: { early_checkin: true, late_checkout: true },
    });
    const decoracao = visiveis.find((v) => v.extra.id === "decoracao");
    expect(decoracao).toBeDefined();
    expect(decoracao?.naoReembolsavel).toBe(true);
  });

  it("check-in a 3 dias: a decoração não é exibida", () => {
    const visiveis = extrasExibiveis("solarium-1", {
      checkin: "2026-09-04",
      checkout: "2026-09-06",
      hoje: "2026-09-01",
      noitesLivres: { early_checkin: true, late_checkout: true },
    });
    expect(visiveis.find((v) => v.extra.id === "decoracao")).toBeUndefined();
  });

  it("a janela conta do check-in, não da data de entrega do item", () => {
    // Cesta da terceira manhã e decoração do primeiro dia: mesma data-limite.
    const limite = dataLimiteCancelamentoExtras("2026-09-11", JANELA_CANCELAMENTO_EXTRAS_DIAS);
    expect(limite).toBe("2026-09-04");
  });
});

// ---------------------------------------------------------------------------
// EXIBIÇÃO DE EXTRAS
// ---------------------------------------------------------------------------

describe("exibição de extras", () => {
  it("early e late só aparecem quando a noite adjacente está livre", () => {
    const ctxLivre = {
      checkin: "2026-09-11",
      checkout: "2026-09-13",
      hoje: "2026-08-01",
      noitesLivres: { early_checkin: true, late_checkout: true },
    };
    const ctxOcupado = { ...ctxLivre, noitesLivres: { early_checkin: false, late_checkout: false } };

    const livres = extrasExibiveis("solarium-1", ctxLivre).map((v) => v.extra.id);
    const ocupados = extrasExibiveis("solarium-1", ctxOcupado).map((v) => v.extra.id);

    expect(livres).toContain("early_checkin");
    expect(livres).toContain("late_checkout");
    expect(ocupados).not.toContain("early_checkin");
    expect(ocupados).not.toContain("late_checkout");
  });

  it("o catálogo tem os 12 itens da especificação", () => {
    expect(EXTRAS).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// FERIADOS
// ---------------------------------------------------------------------------

describe("feriados", () => {
  it("detecta feriado no check-out (o hóspede ainda está na casa)", () => {
    expect(estadiaContemFeriado("2026-09-04", "2026-09-07")).toBe(true);
    expect(feriadosNaEstadia("2026-09-04", "2026-09-07")[0].nome).toBe("Independência");
  });

  it("não inventa feriado onde não há", () => {
    expect(estadiaContemFeriado("2026-09-11", "2026-09-13")).toBe(false);
  });

  it("a cobertura da tabela de feriados não pode ter expirado", () => {
    // Falha de propósito quando o ano corrente passa da cobertura: sem isso o
    // pacote Feriado na Serra fica cego e ninguém percebe.
    expect(new Date().getFullYear()).toBeLessThanOrEqual(ANO_FINAL_FERIADOS);
  });
});

// ---------------------------------------------------------------------------
// SEGURANÇA DO CÁLCULO
// ---------------------------------------------------------------------------

describe("o motor ignora o que vem do cliente", () => {
  it("o total é função apenas da tarifa Hostaway, dos itens e do bônus", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const e = entrada(2, 3400, itens, BONUS);
    const a = calcularPacote(e);
    const b = calcularPacote({ ...e, itens: e.itens.map((i) => ({ ...i })) });
    expect(a.total).toBe(b.total);
    expect(a.total).toBe(3460);
  });

  it("não existe caminho para injetar um total pronto", () => {
    const chaves = Object.keys(entrada(2, 3400, [late()], 0));
    expect(chaves).toEqual(["noites", "hostawayTotal", "itens", "bonusSaida"]);
  });
});
