import { describe, it, expect, vi, beforeEach } from "vitest";

// Só a camada de I/O é falsa. Elegibilidade, motor e mensagens são os de produção.
vi.mock("@/lib/hostaway", async () => {
  const real = await vi.importActual<typeof import("@/lib/hostaway")>("@/lib/hostaway");
  return {
    ...real,
    calculatePriceDetailed: vi.fn(),
    getCalendar: vi.fn(),
  };
});

import { calculatePriceDetailed, getCalendar } from "@/lib/hostaway";
import { calcularPacoteServer } from "./pacote-server";
import { alternativaAncorada } from "./elegibilidade";
import { getPacoteV2 } from "@/config/precos-e-extras";
import { getPropertyBySlug } from "@/config/properties";
import { mensagemChegadaBloqueada } from "./mensagem-chegada";

const PACOTE = getPacoteV2("dois-casais")!;
const CASA = "solarium-completo";

// 20/09/2026 é domingo — o caso relatado em produção.
const DOMINGO = "2026-09-20";
const SAIDA = "2026-09-22";

function dias(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(de + "T12:00:00");
  const fim = new Date(ate + "T12:00:00");
  while (d <= fim) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Calendário livre, com `closedOnArrival` nos dias indicados. */
function calendario(fechados: string[]) {
  return async (_id: number, de: string, ate: string) =>
    dias(de, ate).map((date) => ({
      date,
      isAvailable: 1 as const,
      price: 1700,
      closedOnArrival: (fechados.includes(date) ? 1 : 0) as 0 | 1,
    }));
}

function entrada(checkin = DOMINGO, checkout = SAIDA) {
  return {
    pacote: PACOTE,
    propertySlug: CASA,
    propertyId: getPropertyBySlug(CASA)!.id,
    checkin,
    checkout,
    guests: 4,
    removidos: [],
    selecao: {},
  };
}

beforeEach(() => {
  vi.mocked(calculatePriceDetailed).mockReset();
  vi.mocked(getCalendar).mockReset();
});

describe("A1 — chegada bloqueada chega à tela com o motivo certo", () => {
  it("não cai no erro genérico de cálculo", async () => {
    // A Hostaway recusa a CHEGADA; as noites estão livres.
    vi.mocked(calculatePriceDetailed).mockResolvedValue({
      failure: { reason: "closed-on-arrival", message: mensagemChegadaBloqueada(DOMINGO) },
    } as never);
    vi.mocked(getCalendar).mockImplementation(calendario([DOMINGO]) as never);

    const r = await calcularPacoteServer(entrada());

    expect(r.ok).toBe(false);
    if (r.ok) return;

    // O defeito: `estadiaDisponivel` respondia "livre" (as noites ESTÃO livres),
    // que não é "ocupada", e a função caía no texto de falha técnica. O hóspede
    // lia "tente de novo em instantes" para uma recusa que é permanente.
    expect(r.erro).not.toMatch(/Não conseguimos calcular o preço agora/);
    expect(r.erro).toBe(mensagemChegadaBloqueada(DOMINGO));
    expect(r.erro).toMatch(/não recebe chegadas aos domingos/i);
    expect(r.status).toBe(200);
  });

  it("oferece as duas vizinhas quando as duas dão", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue({
      failure: { reason: "closed-on-arrival", message: mensagemChegadaBloqueada(DOMINGO) },
    } as never);
    // Só o domingo é fechado: 19 (sábado) e 21 (segunda) aceitam chegada.
    vi.mocked(getCalendar).mockImplementation(calendario([DOMINGO]) as never);

    const r = await calcularPacoteServer(entrada());
    expect(r.ok).toBe(false);
    if (r.ok) return;

    const datas = (r.alternativas ?? []).map((a) => a.href);
    expect(datas.some((h) => h.includes("checkin=2026-09-19"))).toBe(true);
    expect(datas.some((h) => h.includes("checkin=2026-09-21"))).toBe(true);
  });

  it("sem vizinha viável, fica só a mensagem (e o WhatsApp que ela já traz)", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue({
      failure: { reason: "closed-on-arrival", message: mensagemChegadaBloqueada(DOMINGO) },
    } as never);
    // Os três dias fechados para chegada: não há o que oferecer.
    vi.mocked(getCalendar).mockImplementation(
      calendario(["2026-09-19", DOMINGO, "2026-09-21"]) as never,
    );

    const r = await calcularPacoteServer(entrada());
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.alternativas ?? []).toEqual([]);
    expect(r.erro).toMatch(/WhatsApp/i);
  });
});

describe("A3 — a alternativa preserva o campo preenchido por último", () => {
  const FINAL = "final-de-ano";
  const CASA_FA = "solarium-1";

  it("âncora na chegada: mantém a chegada e move a saída", () => {
    // 29/12/2026 (terça) com saída em 01/01 (sexta) — o par inválido relatado.
    const alt = alternativaAncorada({
      slug: FINAL,
      propertySlug: CASA_FA,
      checkin: "2026-12-29",
      checkout: "2027-01-01",
      ancora: "checkin",
      guests: 2,
    });

    expect(alt).not.toBeNull();
    expect(alt!.checkin).toBe("2026-12-29");
    expect(alt!.mudou).toBe("checkout");
    expect(alt!.rotulo).toMatch(/Manter a chegada/i);
    // O rótulo diz o que mudou: o hóspede não pode descobrir depois de viajar.
    expect(alt!.rotulo).toContain("03/01");
  });

  it("âncora na saída: mantém a saída e move a chegada", () => {
    // Saída 03/01/2027 (domingo) é válida; a chegada 31/12 (quinta) não é —
    // o pacote só aceita chegada seg/ter/qua. Quem acabou de escolher a saída
    // quer mantê-la: é a chegada que cede.
    const alt = alternativaAncorada({
      slug: FINAL,
      propertySlug: CASA_FA,
      checkin: "2026-12-31",
      checkout: "2027-01-03",
      ancora: "checkout",
      guests: 2,
    });

    expect(alt).not.toBeNull();
    expect(alt!.checkout).toBe("2027-01-03");
    expect(alt!.mudou).toBe("checkin");
    expect(alt!.rotulo).toMatch(/Manter a saída/i);
  });

  it("nenhum campo tocado: pode mover os dois, e o rótulo diz isso", () => {
    const alt = alternativaAncorada({
      slug: FINAL,
      propertySlug: CASA_FA,
      checkin: "2026-12-29",
      checkout: "2027-01-01",
      ancora: null,
      guests: 2,
    });

    expect(alt).not.toBeNull();
    expect(alt!.mudou).toBe("ambos");
    expect(alt!.rotulo).toMatch(/→/);
  });
});
