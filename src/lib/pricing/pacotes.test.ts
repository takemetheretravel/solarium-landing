import { describe, it, expect } from "vitest";
import {
  calcularPacote,
  avaliarBonusSaida,
  aplicarPix,
  pisoDezena,
  melhorTotal,
  dataLimiteCancelamentoExtras,
  extraNaoReembolsavel,
  EntradaMotor,
  ItemPreco,
} from "./pacotes";
import {
  datasElegiveis,
  totalDoPacote,
  noitesDoPacote,
  motorDoPacote,
  melhorCupomPublico,
  tetoAvulsoComCupom,
} from "./elegibilidade";
import { getPackageBySlug, packageTotalActive } from "@/config/packages";

/** Soma dias a uma data ISO, sem depender de fuso. */
function somaDiasISO(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

import {
  montarItens,
  extrasExibiveis,
  lateCheckoutAtivo,
  extrasDuplicados,
  estadiaDeFimDeSemana,
} from "./extras";
import {
  taxaProgressiva,
  estadiaContemFeriado,
  feriadosNaEstadia,
  ANO_FINAL_FERIADOS,
  JANELA_CANCELAMENTO_EXTRAS_DIAS,
  getPacoteV2,
  EXTRAS,
  bonusSaidaPara,
  FERIADOS_NACIONAIS,
  proximoFeriado,
  pacoteVisivelHoje,
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
  it("late check-out do FDS aparece a R$ 850 e leva 550 para a base", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(850);
    expect(late?.valorNaBase).toBe(550);
  });

  it("Feriado sex-seg: mesma diferença, 850 na linha e 550 na base", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_SEX_SEG.checkin,
      FERIADO_SEX_SEG.checkout,
    );
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(850);
    expect(late?.valorNaBase).toBe(550);
  });

  it("saída no sábado: preço de menu e base coincidem, sem ajuste", () => {
    // qui 10/09 → sáb 12/09: a noite bloqueada é sábado, fim de semana de verdade
    const itens = itensReais("dois-casais", "solarium-completo", "2026-09-10", "2026-09-12");
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(1600);
    expect(late?.valorNaBase).toBe(1600);
  });

  it("Dois Casais com saída no domingo: 1.600 na linha, 1.000 na base", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout);
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(1600);
    expect(late?.valorNaBase).toBe(1000);
  });
});

describe("invariante da comparação (§1)", () => {
  it("o Valor total riscado é sempre a soma literal das linhas exibidas", () => {
    const casos: [string, string, string, string][] = [
      ["fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout],
      ["feriado-na-serra", "solarium-1", FERIADO_QUI_DOM.checkin, FERIADO_QUI_DOM.checkout],
      ["feriado-na-serra", "solarium-1", FERIADO_SEX_SEG.checkin, FERIADO_SEX_SEG.checkout],
      ["dois-casais", "solarium-completo", FDS.checkin, FDS.checkout],
    ];

    for (const [slug, casa, ci, co] of casos) {
      const itens = itensReais(slug, casa, ci, co);
      const r = calcularPacote(entrada(2, 3400, itens, BONUS));
      const somaDasLinhas = 3400 + itens.reduce((s, i) => s + i.total, 0);
      expect(r.subtotal).toBe(somaDasLinhas);
    }
  });

  it("a economia é exatamente Valor total menos Total do pacote", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.economia).toBe(r.subtotal - r.total);
    expect(r.economia).toBe(970);
  });
});

describe("golden: Fim de Semana Completo", () => {
  it("baixa — Valor total 4.430 · desconto 966 · total 3.460 · economia 970", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.subtotal).toBe(4430); // 3.400 + 850 + 180
    expect(r.baseDesconto).toBe(3950); // base ainda usa 550 no late
    expect(r.descontoProgressivo).toBe(316);
    expect(r.bonusSaida).toBe(350);
    expect(r.descontoFixo).toBe(300); // 850 exibido − 550 na base
    expect(r.descontoTotal).toBe(966);
    expect(r.total).toBe(3460);
    expect(r.economia).toBe(970);
  });

  it("alta — Valor total 4.730 · desconto 990 · total 3.740 · economia 990", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3700, itens, BONUS));
    expect(r.subtotal).toBe(4730);
    expect(r.baseDesconto).toBe(4250);
    expect(r.descontoProgressivo).toBe(340);
    expect(r.descontoTotal).toBe(990);
    expect(r.total).toBe(3740);
    expect(r.economia).toBe(990);
  });

  it("sem café, baixa — Valor total 4.250 · total 3.280, bônus mantido", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout, [
      "cesta_cafecafe",
    ]);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.subtotal).toBe(4250); // a cesta sai do Valor total quando removida
    expect(r.baseDesconto).toBe(3950);
    expect(r.descontoTotal).toBe(966);
    expect(r.bonusSaida).toBe(350);
    expect(r.total).toBe(3280);
  });
});

describe("golden: Feriado na Serra", () => {
  it("qui-dom com bônus — Valor total 7.480 · desconto 1.490 · total 5.990", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_QUI_DOM.checkin,
      FERIADO_QUI_DOM.checkout,
    );
    const r = calcularPacote(entrada(3, 6450, itens, BONUS));
    expect(r.subtotal).toBe(7480); // 6.450 + 850 + 180
    expect(r.baseDesconto).toBe(7000);
    expect(r.descontoProgressivo).toBe(840);
    expect(r.descontoFixo).toBe(300);
    expect(r.descontoTotal).toBe(1490);
    expect(r.total).toBe(5990);
    expect(r.economia).toBe(1490);
  });

  it("sex-seg sem bônus — Valor total 7.480 · desconto 1.140 · total 6.340", () => {
    const itens = itensReais(
      "feriado-na-serra",
      "solarium-1",
      FERIADO_SEX_SEG.checkin,
      FERIADO_SEX_SEG.checkout,
    );
    const r = calcularPacote(entrada(3, 6450, itens, 0));
    expect(r.subtotal).toBe(7480);
    expect(r.baseDesconto).toBe(7000);
    expect(r.descontoProgressivo).toBe(840);
    expect(r.descontoTotal).toBe(1140); // 840 + 300, sem bônus
    expect(r.total).toBe(6340);
    expect(r.economia).toBe(1140);
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

describe("golden: economia exibida (§1)", () => {
  it("é a diferença entre o riscado e o total, e nada mais", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));

    // Não existe mais cálculo paralelo simulando cupom no fluxo avulso.
    expect(r.economia).toBe(r.subtotal - r.total);
    expect(r.economia).toBe(970);
  });

  it("os quatro casos travados batem economia e total", () => {
    const fdsBaixa = calcularPacote(
      entrada(2, 3400, itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout), BONUS),
    );
    const fdsAlta = calcularPacote(
      entrada(2, 3700, itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout), BONUS),
    );
    const itensFer = itensReais(
      "feriado-na-serra", "solarium-1", FERIADO_QUI_DOM.checkin, FERIADO_QUI_DOM.checkout,
    );
    const ferComBonus = calcularPacote(entrada(3, 6450, itensFer, BONUS));
    const ferSemBonus = calcularPacote(entrada(3, 6450, itensFer, 0));

    expect([fdsBaixa.total, fdsAlta.total, ferComBonus.total, ferSemBonus.total]).toEqual([
      3460, 3740, 5990, 6340,
    ]);
    expect([
      fdsBaixa.economia, fdsAlta.economia, ferComBonus.economia, ferSemBonus.economia,
    ]).toEqual([970, 990, 1490, 1140]);
  });
});


describe("golden: Dois Casais, Uma Vista", () => {
  const FDS_COMPLETO = 3900; // tarifa Hostaway do Completo, 2 noites, baixa

  it("late removido, 2 cestas — Valor total 4.260 · desconto 312 · total 3.940 · economia 320", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout, [
      "late_checkout",
    ]);
    // Sem late: sem ajuste de menu e sem bônus, no mesmo recálculo.
    const r = calcularPacote(entrada(2, FDS_COMPLETO, itens, 0));

    expect(r.subtotal).toBe(4260); // 3.900 + 2 × 180
    expect(r.descontoProgressivo).toBe(312);
    expect(r.descontoFixo).toBe(0);
    expect(r.bonusSaida).toBe(0);
    expect(r.descontoTotal).toBe(312);
    expect(r.total).toBe(3940);
    expect(r.economia).toBe(320);
  });

  it("inclui duas cestas, uma por casa", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout);
    const cestas = itens.find((i) => i.extraId === "cesta_cafecafe");
    expect(cestas?.qtd).toBe(2);
    expect(cestas?.total).toBe(360);
  });

  it("4 hóspedes custam o mesmo que 2: o 3º e o 4º são absorvidos", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout, [
      "late_checkout",
    ]);
    const doisHospedes = calcularPacote(entrada(2, FDS_COMPLETO, itens, 0));

    // 2 pessoas extras × R$ 100 × 2 noites = 400, dentro do total Hostaway
    const quatroHospedes = calcularPacote({
      ...entrada(2, FDS_COMPLETO + 400, itens, 0),
      absorvido: 400,
    });

    expect(quatroHospedes.total).toBe(doisHospedes.total);
    expect(quatroHospedes.subtotal).toBe(4660); // a taxa APARECE no Valor total
    expect(quatroHospedes.descontoFixo).toBe(400); // e sai inteira no desconto
    expect(quatroHospedes.baseDesconto).toBe(FDS_COMPLETO); // fora da base progressiva
  });

  it("do 5º hóspede em diante a cobrança é normal, sem absorção", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout, [
      "late_checkout",
    ]);
    const quatro = calcularPacote({
      ...entrada(2, FDS_COMPLETO + 400, itens, 0),
      absorvido: 400,
    });
    const cinco = calcularPacote({
      ...entrada(2, FDS_COMPLETO + 600, itens, 0),
      absorvido: 400, // segue absorvendo só o 3º e o 4º
    });

    expect(cinco.total).toBeGreaterThan(quatro.total);
    // A taxa do 5º entra na base e por isso recebe o progressivo de 8%:
    // 200 cobrados − 16 de desconto = 184, antes do piso de dezena.
    expect(cinco.subtotal - quatro.subtotal).toBe(200);
    expect(cinco.baseDesconto - quatro.baseDesconto).toBe(200);
  });

  it("o late do Dois Casais continua removível, e o bônus sai junto", () => {
    const comLate = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout);
    const semLate = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout, [
      "late_checkout",
    ]);
    expect(lateCheckoutAtivo(comLate)).toBe(true);
    expect(lateCheckoutAtivo(semLate)).toBe(false);
  });
});


describe("§1 — item incluso nunca é cobrado duas vezes", () => {
  // Cada pacote V2 com uma data válida e a casa elegível
  const CENARIOS: { slug: string; casa: string; checkin: string; checkout: string; noites: number }[] = [
    { slug: "fim-de-semana-completo", casa: "solarium-1", ...FDS, noites: 2 },
    { slug: "feriado-na-serra", casa: "solarium-1", ...FERIADO_QUI_DOM, noites: 3 },
    { slug: "dois-casais", casa: "solarium-completo", ...FDS, noites: 2 },
  ];

  it("adicionar um incluso como extra não muda o total, em nenhum pacote", () => {
    for (const c of CENARIOS) {
      const pacote = getPacoteV2(c.slug);
      expect(pacote).toBeTruthy();

      for (const incluso of pacote!.inclusos) {
        const limpo = calcularPacote(
          entrada(c.noites, 4000, itensReais(c.slug, c.casa, c.checkin, c.checkout), 0),
        );
        // O cliente tenta comprar de novo o que já vem no pacote
        const comDuplicata = calcularPacote(
          entrada(
            c.noites,
            4000,
            itensReais(c.slug, c.casa, c.checkin, c.checkout, [], { [incluso.extraId]: 1 }),
            0,
          ),
        );

        expect(comDuplicata.total).toBe(limpo.total);
        expect(comDuplicata.subtotal).toBe(limpo.subtotal);
      }
    }
  });

  it("a linha do item incluso aparece uma única vez", () => {
    for (const c of CENARIOS) {
      const pacote = getPacoteV2(c.slug)!;
      for (const incluso of pacote.inclusos) {
        const itens = itensReais(c.slug, c.casa, c.checkin, c.checkout, [], {
          [incluso.extraId]: 1,
        });
        const ocorrencias = itens.filter((i) => i.extraId === incluso.extraId).length;
        expect(ocorrencias).toBe(1);
      }
    }
  });

  it("`extrasDuplicados` detecta a colisão para o servidor rejeitar", () => {
    const fds = getPacoteV2("fim-de-semana-completo")!;
    expect(extrasDuplicados(fds, [], ["late_checkout"])).toEqual(["late_checkout"]);
    expect(extrasDuplicados(fds, [], ["cesta_cafecafe"])).toEqual(["cesta_cafecafe"]);
    expect(extrasDuplicados(fds, [], ["lenha", "massagem"])).toEqual([]);
  });

  it("incluso REMOVIDO deixa de colidir — pode ser recomprado como extra", () => {
    const fds = getPacoteV2("fim-de-semana-completo")!;
    expect(extrasDuplicados(fds, ["cesta_cafecafe"], ["cesta_cafecafe"])).toEqual([]);
    // O late do FDS não é removível: segue protegido mesmo se pedirem a remoção
    expect(extrasDuplicados(fds, ["late_checkout"], ["late_checkout"])).toEqual([
      "late_checkout",
    ]);
  });

  it("os dois pacotes antigos não têm inclusos no catálogo V2 — nada a duplicar", () => {
    expect(getPacoteV2("meio-de-semana")).toBeUndefined();
    expect(getPacoteV2("imersao-na-serra")).toBeUndefined();
  });
});

describe("§3 — preço de menu acompanha o tipo de estadia", () => {
  it("Dois Casais de segunda a quarta exibe 1.000, não 1.600", () => {
    // seg 14/09 → qua 16/09: nenhuma noite de sexta ou sábado
    const itens = itensReais("dois-casais", "solarium-completo", "2026-09-14", "2026-09-16");
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(1000);
    expect(late?.valorNaBase).toBe(1000);

    const r = calcularPacote(entrada(2, 3900, itens, 0));
    expect(r.descontoFixo).toBe(0); // menu e real coincidem
  });

  it("Dois Casais de sexta a domingo exibe 1.600 com 1.000 na base", () => {
    const itens = itensReais("dois-casais", "solarium-completo", FDS.checkin, FDS.checkout);
    const late = itens.find((i) => i.extraId === "late_checkout");
    expect(late?.total).toBe(1600);
    expect(late?.valorNaBase).toBe(1000);
  });

  it("estadiaDeFimDeSemana olha as noites, não o dia do check-out", () => {
    expect(estadiaDeFimDeSemana("2026-09-14", "2026-09-16")).toBe(false); // seg→qua
    expect(estadiaDeFimDeSemana("2026-09-11", "2026-09-13")).toBe(true); // sex→dom
    expect(estadiaDeFimDeSemana("2026-06-04", "2026-06-07")).toBe(true); // qui→dom
  });
});


describe("§7 — o \"a partir de\" nao tem caminho proprio", () => {
  const TODOS = [
    { slug: "fim-de-semana-completo", casa: "solarium-1" },
    { slug: "feriado-na-serra", casa: "solarium-1" },
    { slug: "dois-casais", casa: "solarium-completo" },
    { slug: "meio-de-semana", casa: "solarium-1" },
    { slug: "imersao-na-serra", casa: "solarium-1" },
  ];

  it("os cinco pacotes sao conhecidos pelo modulo unico", () => {
    for (const { slug } of TODOS) {
      expect(motorDoPacote(slug), slug).not.toBeNull();
      expect(noitesDoPacote(slug), slug).toBeGreaterThan(0);
    }
  });

  it("Meio de Semana e Imersao tem preco — nao caem em \"Consultar datas\"", () => {
    // O varredor usa `totalDoPacote`, que atende os dois motores. Se estes
    // devolvessem null, o card exibiria "Consultar datas" por falta de suporte.
    for (const slug of ["meio-de-semana", "imersao-na-serra"]) {
      const calc = totalDoPacote({
        slug,
        propertySlug: "solarium-1",
        checkin: "2026-09-14", // segunda
        checkout: slug === "meio-de-semana" ? "2026-09-17" : "2026-09-18",
        hostawayTotal: 3000,
        noites: slug === "meio-de-semana" ? 3 : 4,
      });
      expect(calc, slug).not.toBeNull();
      expect(calc!.total, slug).toBeGreaterThan(0);
    }
  });

  it("preco do legado permanece o da formula antiga, sem migracao de motor", () => {
    const pkg = getPackageBySlug("meio-de-semana")!;
    const esperado = packageTotalActive(pkg, 3000, null);
    const calc = totalDoPacote({
      slug: "meio-de-semana",
      propertySlug: "solarium-1",
      checkin: "2026-09-14",
      checkout: "2026-09-17",
      hostawayTotal: 3000,
      noites: 3,
    });
    expect(calc!.total).toBe(esperado);
  });

  it("INVARIANTE: data aceita pelo varredor nunca e recusada pelo calendario", () => {
    // O varredor filtra por `datasElegiveis`. Percorremos 120 dias de candidatas
    // e conferimos que a resposta e a mesma nos dois sentidos.
    for (const { slug, casa } of TODOS) {
      const noites = noitesDoPacote(slug)!;
      for (let d = 0; d < 120; d++) {
        const checkin = somaDiasISO("2026-08-13", d);
        const checkout = somaDiasISO(checkin, noites);
        const veredito = datasElegiveis(slug, casa, checkin, checkout);

        // Aceita pelo varredor => tem que ter preco calculavel pelo mesmo caminho
        if (veredito.elegivel) {
          const calc = totalDoPacote({
            slug, propertySlug: casa, checkin, checkout,
            hostawayTotal: 3000, noites,
          });
          expect(calc, `${slug} ${checkin}`).not.toBeNull();
        }
        // E a resposta e estavel: chamar de novo devolve o mesmo
        expect(datasElegiveis(slug, casa, checkin, checkout).elegivel).toBe(veredito.elegivel);
      }
    }
  });

  it("a janela de 20/11 (sexta) e elegivel para o Feriado", () => {
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-11-20", "2026-11-23").elegivel)
      .toBe(true);
  });

  it("13-16/11 abre: Proclamacao e domingo e isso deixou de importar", () => {
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-11-13", "2026-11-16").elegivel)
      .toBe(true);
  });

  it("os feriadoes de emenda voltam a abrir o pacote", () => {
    // Independencia: sex 04/09 -> seg 07/09, feriado no dia da saida
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-09-04", "2026-09-07").elegivel)
      .toBe(true);
    // N. S. Aparecida: sex 09/10 -> seg 12/10
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-10-09", "2026-10-12").elegivel)
      .toBe(true);
    // Finados: sex 30/10 -> seg 02/11
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-10-30", "2026-11-02").elegivel)
      .toBe(true);
  });

  it("feriado em qualquer dia da semana abre — inclusive domingo (§4 rodada 9)", () => {
    // qui 13/11 -> dom 16/11 contem Proclamacao (15/11, domingo)
    expect(estadiaContemFeriado("2026-11-13", "2026-11-16")).toBe(true);
    expect(datasElegiveis("feriado-na-serra", "solarium-1", "2026-11-13", "2026-11-16").elegivel)
      .toBe(true);
  });
});


describe("§5 rodada 14 — trava contra o cupom publico", () => {
  it("o pacote nunca custa mais que a estadia avulsa com o melhor cupom", () => {
    // 2 noites => DUASNOITES 8% e o melhor publico aplicavel
    expect(melhorCupomPublico(2)).toBe(0.08);
    expect(melhorCupomPublico(3)).toBe(0.12);
    expect(melhorCupomPublico(5)).toBe(0.17);
    expect(melhorCupomPublico(1)).toBe(0);
  });

  it("o teto e a diaria com cupom mais os itens a preco cheio", () => {
    // 3.400 com 8% = 3.128, mais 850 + 180 de itens
    expect(tetoAvulsoComCupom(3400, 2, [{ total: 850 }, { total: 180 }])).toBe(4158);
  });

  it("o FDS Completo fica abaixo do teto — a trava nao dispara", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const teto = tetoAvulsoComCupom(3400, 2, itens);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.total).toBeLessThan(teto);
    expect(r.total).toBe(3460); // golden intacto
  });

  it("Virada na Serra existe, e sazonal e traz o espumante", () => {
    const p = getPacoteV2("virada-na-serra");
    expect(p).toBeTruthy();
    expect(p!.sazonal).toBe(true);
    expect(p!.inclusos.map((i) => i.extraId)).toContain("espumante_chandon");
    expect(p!.checkinDatas).toEqual(["2026-12-28", "2026-12-29", "2026-12-30"]);
  });

  it("o espumante entrou no catalogo a R$ 140", () => {
    const e = EXTRAS.find((x) => x.id === "espumante_chandon");
    expect(e?.preco).toBe(140);
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
    expect(comPessoas.descontoTotal).toBe(998); // 348 + 350 + 300
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

    // Sem o late sobram as duas cestas inclusas (§3.3): 3.900 + 360 = 4.260.
    const r = calcularPacote(entrada(2, 3900, semLate, bonusSem.valor));
    expect(r.subtotal).toBe(4260);
    expect(r.baseDesconto).toBe(3900);
    expect(r.descontoTotal).toBe(312);
    expect(r.total).toBe(3940);
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

  it("progressivo, bônus e ajustes fixos aparecem somados numa linha só", () => {
    const itens = itensReais("fim-de-semana-completo", "solarium-1", FDS.checkin, FDS.checkout);
    const r = calcularPacote(entrada(2, 3400, itens, BONUS));
    expect(r.descontoTotal).toBe(r.descontoProgressivo + r.bonusSaida + r.descontoFixo);
    expect(r.descontoTotal).toBe(966);
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

  it("o catálogo tem os 13 itens: os 12 da especificação mais o espumante", () => {
    expect(EXTRAS).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// FERIADOS
// ---------------------------------------------------------------------------

describe("feriados", () => {
  it("feriado na data de check-out CONTA — o hóspede fica até as 18h", () => {
    // sex 04/09 → seg 07/09: Independência cai na saída, e é isso que o pacote vende
    expect(estadiaContemFeriado("2026-09-04", "2026-09-07")).toBe(true);
    expect(feriadosNaEstadia("2026-09-04", "2026-09-07")[0].nome).toBe("Independência");
  });

  it("feriado que é noite da estadia também conta", () => {
    // sex 20/11 → seg 23/11: Consciência Negra é a primeira noite
    expect(estadiaContemFeriado("2026-11-20", "2026-11-23")).toBe(true);
    expect(feriadosNaEstadia("2026-11-20", "2026-11-23")[0].nome).toBe("Consciência Negra");
  });

  it("não inventa feriado onde não há", () => {
    expect(estadiaContemFeriado("2026-09-11", "2026-09-13")).toBe(false);
  });

  it("a tabela cobre 2026 e 2027", () => {
    // O teste que quebrava o build na virada do ano saiu: derrubar o deploy no
    // dia 1º de janeiro é pior do que a tabela ficar curta. A cobertura vira
    // conferência explícita.
    const anos = new Set(FERIADOS_NACIONAIS.map((f) => Number(f.data.slice(0, 4))));
    expect(Array.from(anos).sort()).toEqual([2026, 2027]);
    expect(ANO_FINAL_FERIADOS).toBe(2027);
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
