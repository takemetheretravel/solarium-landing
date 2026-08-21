import { describe, it, expect } from "vitest";
import { datasElegiveis } from "./elegibilidade";
import { getPacoteV2 } from "@/config/precos-e-extras";

/**
 * A REGRA É SOBRE AS NOITES.
 *
 * Nenhuma noite da estadia pode cair em sexta, sábado ou domingo. Escrever isso
 * como "dia de chegada" abriu a chegada no domingo em produção: domingo é dia de
 * semana, mas a estadia que chega no domingo ocupa a noite de domingo.
 *
 * Estes testes percorrem os sete dias da semana como chegada e afirmam
 * exatamente quais passam. Não há como reintroduzir o domingo sem quebrar aqui.
 */

const CASA = "solarium-1";
const NOME_DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Uma semana de chegadas a partir de um domingo, longe de feriados. */
const DOMINGO_BASE = "2026-09-13";

function somaDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function noitesDaEstadia(checkin: string, noites: number): number[] {
  return Array.from({ length: noites }, (_, i) =>
    new Date(somaDias(checkin, i) + "T12:00:00").getDay(),
  );
}

const CASOS = [
  { slug: "meio-de-semana", noites: 3, aceitos: [1, 2] },
  { slug: "imersao-na-serra", noites: 4, aceitos: [1] },
];

describe("§ urgente — pacotes de meio de semana validam pelas noites ocupadas", () => {
  for (const caso of CASOS) {
    it(`${caso.slug}: das sete chegadas, só ${caso.aceitos.map((d) => NOME_DOW[d]).join(" e ")}`, () => {
      const aceitos: number[] = [];

      for (let i = 0; i < 7; i++) {
        const checkin = somaDias(DOMINGO_BASE, i);
        const checkout = somaDias(checkin, caso.noites);
        const dow = new Date(checkin + "T12:00:00").getDay();
        expect(dow).toBe(i); // a base é domingo: o índice é o dia da semana

        if (datasElegiveis(caso.slug, CASA, checkin, checkout).elegivel) aceitos.push(dow);
      }

      expect(aceitos).toEqual(caso.aceitos);
    });

    it(`${caso.slug}: chegada no domingo é recusada, com o motivo certo`, () => {
      const e = datasElegiveis(caso.slug, CASA, DOMINGO_BASE, somaDias(DOMINGO_BASE, caso.noites));
      expect(e.elegivel).toBe(false);
      if (!e.elegivel) expect(e.motivo).toContain("segunda a quinta");
    });

    it(`${caso.slug}: nenhuma chegada aceita produz noite de sexta, sábado ou domingo`, () => {
      for (let i = 0; i < 7; i++) {
        const checkin = somaDias(DOMINGO_BASE, i);
        const checkout = somaDias(checkin, caso.noites);
        if (!datasElegiveis(caso.slug, CASA, checkin, checkout).elegivel) continue;

        for (const dow of noitesDaEstadia(checkin, caso.noites)) {
          expect([5, 6, 0]).not.toContain(dow);
        }
      }
    });

    it(`${caso.slug}: a regra vive nas noites, não no dia de chegada`, () => {
      const p = getPacoteV2(caso.slug)!;
      expect(p.noitesProibidasDow).toEqual([5, 6, 0]);
      // `checkinDows` seria uma segunda descrição da mesma coisa — e foi
      // exatamente a tradução que abriu o domingo.
      expect(p.checkinDows).toBeNull();
    });
  }

  it("a semana inteira, varrida em quatro semanas seguidas, dá o mesmo resultado", () => {
    // Guarda contra um acerto por acaso na semana escolhida.
    for (let semana = 0; semana < 4; semana++) {
      for (const caso of CASOS) {
        const aceitos: number[] = [];
        for (let i = 0; i < 7; i++) {
          const checkin = somaDias(DOMINGO_BASE, semana * 7 + i);
          const checkout = somaDias(checkin, caso.noites);
          if (datasElegiveis(caso.slug, CASA, checkin, checkout).elegivel) {
            aceitos.push(new Date(checkin + "T12:00:00").getDay());
          }
        }
        expect(aceitos).toEqual(caso.aceitos);
      }
    }
  });
});

describe("§ urgente — os outros quatro pacotes não têm regra traduzida", () => {
  it("só os dois migrados descrevem noites proibidas", () => {
    // Os quatro nasceram no V2 já falando de dia de chegada, que é a regra do
    // produto neles: o Fim de Semana Completo VENDE a noite de sexta e sábado.
    for (const slug of ["fim-de-semana-completo", "dois-casais", "feriado-na-serra", "final-de-ano"]) {
      expect(getPacoteV2(slug)?.noitesProibidasDow).toBeUndefined();
    }
  });

  it("o Fim de Semana Completo continua chegando na sexta", () => {
    expect(datasElegiveis("fim-de-semana-completo", CASA, "2026-09-18", "2026-09-20").elegivel).toBe(
      true,
    );
  });
});
