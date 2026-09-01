import { describe, it, expect, vi, beforeEach } from "vitest";
import { chegadaPermitida } from "./restricoes-chegada";
import { mensagemChegadaBloqueada } from "./mensagem-chegada";

/**
 * Restrições de CHEGADA vindas da Hostaway.
 *
 * O caso que originou estes testes: o pacote Dois Casais, Uma Vista oferecia
 * entrada no domingo no Solarium Completo, dia que a Hostaway recusa. A reserva
 * era vendida e não podia ser efetivada.
 *
 * A distinção que os testes travam: a restrição é de CHEGADA, não de ocupação.
 * Passar por cima de um domingo no meio da estadia sempre foi permitido e
 * precisa continuar sendo.
 */

const getCalendar = vi.fn();
vi.mock("@/lib/hostaway", () => ({ getCalendar: (...a: unknown[]) => getCalendar(...a) }));
// Espelha o real: slug desconhecido devolve lista VAZIA, e nao uma listing
// qualquer. Um mock permissivo demais aqui esconderia o caso de casa invalida.
vi.mock("@/config/operational-extras", () => ({
  listingsForProperty: (slug: string) => {
    if (slug === "solarium-completo") return [316007, 316005];
    if (slug === "solarium-1" || slug === "solarium-2") return [316006];
    return [];
  },
}));

// Imports estaticos: `vi.mock` e hoisted pelo vitest, entao os mocks acima ja
// valem aqui. Top-level await quebraria o `tsc --noEmit` do projeto.

/** Um dia de calendário; `cta` liga o `closedOnArrival`. */
function dia(date: string, cta: 0 | 1 = 0) {
  return { date, isAvailable: 1, status: "available", price: 1000, minimumStay: 1, closedOnArrival: cta };
}

beforeEach(() => getCalendar.mockReset());

describe("restrições de chegada", () => {
  it("recusa chegada em dia marcado closedOnArrival", async () => {
    getCalendar.mockResolvedValue([dia("2026-09-06", 1)]); // domingo
    const r = await chegadaPermitida("solarium-1", "2026-09-06");
    expect(r.permitida).toBe(false);
    if (!r.permitida) {
      expect(r.indeterminado).toBe(false);
      expect(r.motivo).toContain("não recebe chegadas");
    }
  });

  it("aceita chegada em dia liberado", async () => {
    getCalendar.mockResolvedValue([dia("2026-09-04", 0)]); // sexta
    const r = await chegadaPermitida("solarium-1", "2026-09-04");
    expect(r.permitida).toBe(true);
  });

  it("a restrição é de chegada, não de ocupação: domingo NO MEIO da estadia passa", async () => {
    // Chegada na sexta, com domingo bloqueado para CHEGADA dentro do período.
    // Só o dia de entrada é consultado — o domingo no meio nunca é perguntado.
    getCalendar.mockResolvedValue([dia("2026-09-04", 0)]);
    const r = await chegadaPermitida("solarium-1", "2026-09-04");
    expect(r.permitida).toBe(true);
    // Uma única consulta, do dia de chegada.
    expect(getCalendar).toHaveBeenCalledTimes(1);
    expect(getCalendar).toHaveBeenCalledWith(316006, "2026-09-04", "2026-09-04");
  });

  it("Completo: basta UMA das duas listings recusar", async () => {
    // 316007 libera, 316005 bloqueia. A casa inteira não pode ser entregue
    // pela metade, então a data está fora.
    getCalendar
      .mockResolvedValueOnce([dia("2026-09-06", 0)])
      .mockResolvedValueOnce([dia("2026-09-06", 1)]);
    const r = await chegadaPermitida("solarium-completo", "2026-09-06");
    expect(r.permitida).toBe(false);
  });

  it("Completo: as duas liberando, a chegada passa", async () => {
    getCalendar
      .mockResolvedValueOnce([dia("2026-09-04", 0)])
      .mockResolvedValueOnce([dia("2026-09-04", 0)]);
    const r = await chegadaPermitida("solarium-completo", "2026-09-04");
    expect(r.permitida).toBe(true);
  });

  it("calendário sem o dia é indeterminado, não permissão", async () => {
    // Não inventamos permissão a partir de ausência de dado: quem cobra recusa.
    getCalendar.mockResolvedValue([]);
    const r = await chegadaPermitida("solarium-1", "2026-09-06");
    expect(r.permitida).toBe(false);
    if (!r.permitida) expect(r.indeterminado).toBe(true);
  });

  it("casa desconhecida é indeterminada", async () => {
    getCalendar.mockResolvedValue([dia("2026-09-04", 0)]);
    const r = await chegadaPermitida("", "2026-09-04");
    expect(r.permitida).toBe(false);
  });
});

describe("mensagem ao hóspede", () => {
  it("usa a preposição certa e não fala em erro", () => {
    expect(mensagemChegadaBloqueada("2026-09-06")).toContain("aos domingos"); // domingo
    expect(mensagemChegadaBloqueada("2026-09-07")).toContain("às segundas"); // segunda
    expect(mensagemChegadaBloqueada("2026-09-05")).toContain("aos sábados"); // sábado

    const m = mensagemChegadaBloqueada("2026-09-06").toLowerCase();
    expect(m).not.toContain("erro");
    expect(m).not.toContain("indisponív");
    expect(m).toContain("whatsapp");
  });
});
