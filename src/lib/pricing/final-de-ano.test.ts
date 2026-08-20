import { describe, it, expect } from "vitest";
import { datasElegiveis, totalDoPacote } from "./elegibilidade";
import { montarItens } from "./extras";
import { getPacoteV2, taxaProgressiva } from "@/config/precos-e-extras";

const PACOTE = getPacoteV2("final-de-ano")!;
const CASA = "solarium-1";

/** As nove combinações que o atendimento vende: três chegadas × três saídas. */
const COMBINACOES: { checkin: string; sabado: string; domingo: string; segunda: string }[] = [
  { checkin: "2026-12-28", sabado: "2027-01-02", domingo: "2027-01-03", segunda: "2027-01-04" },
  { checkin: "2026-12-29", sabado: "2027-01-02", domingo: "2027-01-03", segunda: "2027-01-04" },
  { checkin: "2026-12-30", sabado: "2027-01-02", domingo: "2027-01-03", segunda: "2027-01-04" },
  { checkin: "2026-12-21", sabado: "2026-12-26", domingo: "2026-12-27", segunda: "2026-12-28" },
  { checkin: "2026-12-22", sabado: "2026-12-26", domingo: "2026-12-27", segunda: "2026-12-28" },
  { checkin: "2026-12-23", sabado: "2026-12-26", domingo: "2026-12-27", segunda: "2026-12-28" },
];

function noites(checkin: string, checkout: string): number {
  return Math.round(
    (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
      86400000,
  );
}

describe("§2 rodada 20 — Final de Ano aceita as três saídas de cada chegada", () => {
  for (const c of COMBINACOES) {
    for (const [dia, checkout] of [
      ["sábado", c.sabado],
      ["domingo", c.domingo],
      ["segunda", c.segunda],
    ] as const) {
      it(`${c.checkin} → ${checkout} (${dia}, ${noites(c.checkin, checkout)} noites)`, () => {
        const e = datasElegiveis(PACOTE.slug, CASA, c.checkin, checkout);
        expect(e.elegivel ? "" : e.motivo).toBe("");
      });
    }
  }
});

describe("§2 rodada 20 — cada saída tem o seu late e a sua taxa", () => {
  for (const c of COMBINACOES) {
    it(`chegada ${c.checkin}: domingo com late, sábado e segunda sem`, () => {
      const itensDe = (checkout: string) =>
        montarItens({
          pacote: PACOTE,
          propertySlug: CASA,
          checkin: c.checkin,
          checkout,
          removidos: [],
          selecao: {},
        }).map((i) => i.extraId);

      expect(itensDe(c.domingo)).toContain("late_checkout");
      expect(itensDe(c.sabado)).not.toContain("late_checkout");
      expect(itensDe(c.segunda)).not.toContain("late_checkout");
    });

    it(`chegada ${c.checkin}: sábado perde 5 pontos de progressivo`, () => {
      // Tarifa fixa nos três: o que muda entre eles é só a regra do pacote.
      const H = 10000;
      const totalDe = (checkout: string) =>
        totalDoPacote({
          slug: PACOTE.slug,
          propertySlug: CASA,
          checkin: c.checkin,
          checkout,
          hostawayTotal: H,
          noites: noites(c.checkin, checkout),
        })!.resultado!;

      const sab = totalDe(c.sabado);
      const seg = totalDe(c.segunda);

      // Mesma base, taxas diferentes: a do sábado é a cheia menos 5 pontos.
      expect(sab.taxa).toBeCloseTo(taxaProgressiva(noites(c.checkin, c.sabado)) - 0.05, 10);
      expect(seg.taxa).toBeCloseTo(taxaProgressiva(noites(c.checkin, c.segunda)), 10);
    });
  }
});
