import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/hostaway", () => ({
  calculatePriceDetailed: vi.fn(),
  getCalendar: vi.fn(),
}));

import { calculatePriceDetailed, getCalendar } from "@/lib/hostaway";
import { calcularPacoteServer } from "./pacote-server";
import { totalDoPacote } from "./elegibilidade";
import { getPacoteV2 } from "@/config/precos-e-extras";
import { getPropertyBySlug } from "@/config/properties";

const FINAL_DE_ANO = getPacoteV2("final-de-ano")!;
const FDS = getPacoteV2("fim-de-semana-completo")!;
const CASA = "solarium-1";
const DIARIA = 1000;

/** Mínimo de noites por data de chegada, como a Hostaway devolve na virada. */
const MINIMO: Record<string, number> = {
  "2026-12-28": 6,
  "2026-12-29": 5,
  "2026-12-30": 4,
};

function noites(checkin: string, checkout: string): number {
  return Math.round(
    (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
      86400000,
  );
}

/**
 * Emula a Hostaway: recusa por mínimo de noites, a menos que a chamada peça
 * explicitamente para ignorar. É o comportamento que a reserva de teste real
 * (65058672, 28/12 → 02/01 com mínimo 6) confirmou na API.
 */
function hostawayFalsa() {
  vi.mocked(calculatePriceDetailed).mockImplementation(
    (async (
      _id: number,
      checkin: string,
      checkout: string,
      _guests: number,
      opcoes?: { ignorarMinimoDeNoites?: boolean },
    ) => {
      const n = noites(checkin, checkout);
      const minimo = MINIMO[checkin] ?? 1;
      if (n < minimo && !opcoes?.ignorarMinimoDeNoites) {
        return {
          failure: {
            reason: "min-stay-not-met",
            message: `Esta data exige no mínimo ${minimo} noites.`,
            meta: { minimumStay: minimo, requested: n },
          },
        };
      }
      return { quote: { nights: n, totalPrice: n * DIARIA } };
    }) as never,
  );

  vi.mocked(getCalendar).mockImplementation((async (_id: number, de: string, ate: string) => {
    const out = [];
    const d = new Date(de + "T12:00:00");
    const fim = new Date(ate + "T12:00:00");
    while (d <= fim) {
      out.push({ date: d.toISOString().slice(0, 10), isAvailable: 1, price: DIARIA, minimumStay: 1 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }) as never);
}

const COMBINACOES: [string, string][] = [
  ["2026-12-28", "2027-01-02"],
  ["2026-12-28", "2027-01-03"],
  ["2026-12-28", "2027-01-04"],
  ["2026-12-29", "2027-01-02"],
  ["2026-12-29", "2027-01-03"],
  ["2026-12-29", "2027-01-04"],
  ["2026-12-30", "2027-01-02"],
  ["2026-12-30", "2027-01-03"],
  ["2026-12-30", "2027-01-04"],
];

function entrada(pacote: typeof FINAL_DE_ANO, checkin: string, checkout: string) {
  return {
    pacote,
    propertySlug: CASA,
    propertyId: getPropertyBySlug(CASA)!.id,
    checkin,
    checkout,
    guests: 2,
    removidos: [],
    selecao: {},
  };
}

beforeEach(() => {
  vi.mocked(calculatePriceDetailed).mockReset();
  vi.mocked(getCalendar).mockReset();
  hostawayFalsa();
});

describe("§1 rodada 21 — Final de Ano vende abaixo do mínimo do PMS", () => {
  it("o bypass está ligado só neste pacote", () => {
    expect(FINAL_DE_ANO.ignorarMinimoPMS).toBe(true);
    for (const slug of [
      "fim-de-semana-completo",
      "dois-casais",
      "feriado-na-serra",
      "meio-de-semana",
      "imersao-na-serra",
    ]) {
      expect(getPacoteV2(slug)?.ignorarMinimoPMS).toBeUndefined();
    }
  });

  for (const [checkin, checkout] of COMBINACOES) {
    it(`${checkin} → ${checkout} cota, mesmo abaixo do mínimo`, async () => {
      const r = await calcularPacoteServer(entrada(FINAL_DE_ANO, checkin, checkout));

      expect(r.ok ? "" : r.erro).toBe("");
      if (!r.ok) return;
      expect(r.resultado.total).toBeGreaterThan(0);
      expect(r.resultado.noites).toBe(noites(checkin, checkout));
      // Nada de valor inventado: a diária vem do calendário, sempre.
      expect(r.resultado.hostawayTotal).toBe(noites(checkin, checkout) * DIARIA);
    });
  }

  it("pacote sem a marca continua recusado abaixo do mínimo", async () => {
    // Chegada 28/12 exige 6 noites; o Fim de Semana Completo é de 2 e não tem
    // permissão para furar o mínimo.
    const r = await calcularPacoteServer({
      ...entrada(FDS, "2026-12-28", "2026-12-30"),
      pacote: FDS,
    });
    expect(r.ok).toBe(false);
  });
});

describe("§1 rodada 21 — preço tem um dono só", () => {
  for (const [checkin, checkout] of COMBINACOES) {
    it(`${checkin} → ${checkout}: API e varredor chegam ao mesmo total`, async () => {
      const servidor = await calcularPacoteServer(entrada(FINAL_DE_ANO, checkin, checkout));
      expect(servidor.ok).toBe(true);
      if (!servidor.ok) return;

      const n = noites(checkin, checkout);
      const varredor = totalDoPacote({
        slug: FINAL_DE_ANO.slug,
        propertySlug: CASA,
        checkin,
        checkout,
        hostawayTotal: n * DIARIA,
        noites: n,
        noiteSeguinteLivre: true,
      });

      // A saída de sábado perde 5 pontos de progressivo. Esse ajuste vivia só no
      // varredor: a tela e o draft cobravam com a taxa cheia, mais barato do que
      // o pacote define.
      expect(servidor.resultado.total).toBe(varredor!.total);
    });
  }

  it("a saída de sábado custa mais que a de domingo pela taxa, não por acaso", async () => {
    const sabado = await calcularPacoteServer(entrada(FINAL_DE_ANO, "2026-12-30", "2027-01-02"));
    const domingo = await calcularPacoteServer(entrada(FINAL_DE_ANO, "2026-12-30", "2027-01-03"));
    expect(sabado.ok && domingo.ok).toBe(true);
    if (!sabado.ok || !domingo.ok) return;

    expect(sabado.resultado.taxa).toBeCloseTo(0.12 - 0.05, 10);
    expect(domingo.resultado.taxa).toBeCloseTo(0.12, 10);
  });
});
