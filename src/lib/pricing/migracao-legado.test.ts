import { describe, it, expect } from "vitest";
import { datasElegiveis, totalDoPacote, motorDoPacote } from "./elegibilidade";
import { getPacoteV2 } from "@/config/precos-e-extras";

/**
 * TABELA DE REFERÊNCIA — gerada do motor ANTIGO antes da migração.
 *
 * Cada linha é um total que o Meio de Semana ou a Imersão entregavam com o motor
 * legado. O motor V2 tem de reproduzir cada um exatamente. Divergir aqui
 * significa que a migração mudou preço, que é o que ela não pode fazer.
 *
 * DEZ DESTAS LINHAS TÊM CHEGADA NO DOMINGO e hoje são recusadas.
 *
 * Não é preço errado: o motor antigo aceitava domingo — o `weekdaysOnly` dele
 * testava só sexta e sábado —, ainda que a copy do produto dissesse "noites de
 * segunda a quinta". A tabela foi gerada com essa regra. O preço delas continua
 * conferido; o que mudou é que a data deixou de ser vendável. Ver
 * `noites-de-semana.test.ts`.
 */
const REFERENCIA: {
  slug: string;
  checkin: string;
  checkout: string;
  hostawayTotal: number;
  total: number;
}[] = [
  { slug: "meio-de-semana", checkin: "2026-09-13", checkout: "2026-09-16", hostawayTotal: 2400, total: 2650 },
  { slug: "meio-de-semana", checkin: "2026-09-13", checkout: "2026-09-16", hostawayTotal: 6000, total: 5820 },
  { slug: "meio-de-semana", checkin: "2026-09-14", checkout: "2026-09-17", hostawayTotal: 3000, total: 3180 },
  { slug: "meio-de-semana", checkin: "2026-09-14", checkout: "2026-09-17", hostawayTotal: 7777, total: 7380 },
  { slug: "meio-de-semana", checkin: "2026-09-15", checkout: "2026-09-18", hostawayTotal: 3457, total: 3580 },
  { slug: "meio-de-semana", checkin: "2026-09-15", checkout: "2026-09-18", hostawayTotal: 8880, total: 8350 },
  { slug: "meio-de-semana", checkin: "2026-10-19", checkout: "2026-10-22", hostawayTotal: 3999, total: 4050 },
  { slug: "meio-de-semana", checkin: "2026-10-19", checkout: "2026-10-22", hostawayTotal: 9999, total: 9330 },
  { slug: "meio-de-semana", checkin: "2026-11-08", checkout: "2026-11-11", hostawayTotal: 4200, total: 4230 },
  { slug: "meio-de-semana", checkin: "2026-11-08", checkout: "2026-11-11", hostawayTotal: 10500, total: 9780 },
  { slug: "meio-de-semana", checkin: "2027-03-01", checkout: "2027-03-04", hostawayTotal: 5123, total: 5040 },
  { slug: "meio-de-semana", checkin: "2027-03-01", checkout: "2027-03-04", hostawayTotal: 12345, total: 11400 },
  { slug: "imersao-na-serra", checkin: "2026-09-13", checkout: "2026-09-17", hostawayTotal: 6000, total: 6300 },
  { slug: "imersao-na-serra", checkin: "2026-09-13", checkout: "2026-09-17", hostawayTotal: 2400, total: 3130 },
  { slug: "imersao-na-serra", checkin: "2026-09-14", checkout: "2026-09-18", hostawayTotal: 7777, total: 7860 },
  { slug: "imersao-na-serra", checkin: "2026-09-14", checkout: "2026-09-18", hostawayTotal: 3000, total: 3660 },
  { slug: "imersao-na-serra", checkin: "2026-10-18", checkout: "2026-10-22", hostawayTotal: 8880, total: 8830 },
  { slug: "imersao-na-serra", checkin: "2026-10-18", checkout: "2026-10-22", hostawayTotal: 3457, total: 4060 },
  { slug: "imersao-na-serra", checkin: "2026-11-09", checkout: "2026-11-13", hostawayTotal: 9999, total: 9810 },
  { slug: "imersao-na-serra", checkin: "2026-11-09", checkout: "2026-11-13", hostawayTotal: 3999, total: 4530 },
  { slug: "imersao-na-serra", checkin: "2027-03-01", checkout: "2027-03-05", hostawayTotal: 10500, total: 10260 },
  { slug: "imersao-na-serra", checkin: "2027-03-01", checkout: "2027-03-05", hostawayTotal: 4200, total: 4710 },
  { slug: "imersao-na-serra", checkin: "2027-04-11", checkout: "2027-04-15", hostawayTotal: 12345, total: 11880 },
  { slug: "imersao-na-serra", checkin: "2027-04-11", checkout: "2027-04-15", hostawayTotal: 5123, total: 5520 },
];

const CASA = "solarium-1";

function noites(checkin: string, checkout: string): number {
  return Math.round(
    (new Date(checkout + "T12:00:00").getTime() - new Date(checkin + "T12:00:00").getTime()) /
      86400000,
  );
}

describe("§1 rodada 20 — a migração não pode mexer em preço", () => {
  it("os dois pacotes migrados rodam no motor V2", () => {
    for (const slug of ["meio-de-semana", "imersao-na-serra"]) {
      expect(motorDoPacote(slug)?.motor).toBe("v2");
      expect(getPacoteV2(slug)).toBeTruthy();
    }
  });

  for (const r of REFERENCIA) {
    const chegaNoDomingo = new Date(r.checkin + "T12:00:00").getDay() === 0;

    it(`${r.slug} ${r.checkin}→${r.checkout} com diária ${r.hostawayTotal}: ${r.total}`, () => {
      const e = datasElegiveis(r.slug, CASA, r.checkin, r.checkout);
      // Chegada no domingo era aceita pelo motor antigo e não é mais. O preço
      // segue sendo o mesmo — a linha continua valendo como referência de valor.
      expect(e.elegivel).toBe(!chegaNoDomingo);

      const calc = totalDoPacote({
        slug: r.slug,
        propertySlug: CASA,
        checkin: r.checkin,
        checkout: r.checkout,
        hostawayTotal: r.hostawayTotal,
        noites: noites(r.checkin, r.checkout),
      });

      expect(calc?.total).toBe(r.total);
    });
  }
});

describe("§1 rodada 20 — as regras de data continuam as do motor antigo", () => {
  it("noite de sexta ou sábado derruba o Meio de Semana", () => {
    // Quarta a sábado tem sexta dentro; quinta a domingo tem sexta e sábado.
    expect(datasElegiveis("meio-de-semana", CASA, "2026-09-16", "2026-09-19").elegivel).toBe(false);
    expect(datasElegiveis("meio-de-semana", CASA, "2026-09-17", "2026-09-20").elegivel).toBe(false);
  });

  it("noite de sexta derruba a Imersão", () => {
    expect(datasElegiveis("imersao-na-serra", CASA, "2026-09-15", "2026-09-19").elegivel).toBe(false);
  });

  it("janela bloqueada continua recusada", () => {
    // Segunda 16/02 a quinta 19/02: noites de dia de semana, mas 16 e 17/02 estão
    // na janela do Carnaval. A chegada precisa ser válida para o teste medir a
    // janela, e não a regra das noites.
    const e = datasElegiveis("meio-de-semana", CASA, "2026-02-16", "2026-02-19");
    expect(e.elegivel).toBe(false);
    if (!e.elegivel) expect(e.motivo).toContain("feriados");
  });

  it("duração diferente da do pacote é recusada", () => {
    expect(datasElegiveis("meio-de-semana", CASA, "2026-09-14", "2026-09-16").elegivel).toBe(false);
    expect(datasElegiveis("imersao-na-serra", CASA, "2026-09-14", "2026-09-17").elegivel).toBe(false);
  });
});
