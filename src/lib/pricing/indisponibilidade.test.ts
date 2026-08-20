import { describe, it, expect, vi, beforeEach } from "vitest";

// A camada de I/O é a única coisa falsa aqui: elegibilidade, motor e mensagens
// são os de produção.
vi.mock("@/lib/hostaway", () => ({
  calculatePriceDetailed: vi.fn(),
  getCalendar: vi.fn(),
}));

import { calculatePriceDetailed, getCalendar } from "@/lib/hostaway";
import { calcularPacoteServer } from "./pacote-server";
import { getPacoteV2 } from "@/config/precos-e-extras";
import { getPropertyBySlug } from "@/config/properties";

const SOL1 = 316007;
const SOL2 = 316005;

const PACOTE = getPacoteV2("fim-de-semana-completo")!;

// Sexta 11/09/2026 → domingo 13/09/2026: datas que o pacote aceita.
const CHECKIN = "2026-09-11";
const CHECKOUT = "2026-09-13";

function dias(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(de + "T12:00:00");
  const fim = new Date(ate + "T12:00:00");
  while (d <= fim) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Calendário falso: livre em tudo, menos nas noites listadas por listing. */
function calendarioCom(ocupadas: Record<number, string[]>) {
  return async (listingId: number, de: string, ate: string) =>
    dias(de, ate).map((date) => ({
      date,
      isAvailable: (ocupadas[listingId] ?? []).includes(date) ? 0 : 1,
      price: 1700,
    }));
}

function entrada(propertySlug: string, checkin = CHECKIN, checkout = CHECKOUT) {
  return {
    pacote: PACOTE,
    propertySlug,
    propertyId: getPropertyBySlug(propertySlug)!.id,
    checkin,
    checkout,
    guests: 2,
    removidos: [],
    selecao: {},
  };
}

/** Recusa da Hostaway, no formato que `calculatePriceDetailed` devolve. */
function recusa(reason: string, meta?: Record<string, unknown>) {
  return { failure: { reason, message: `falha: ${reason}`, meta } } as never;
}

beforeEach(() => {
  vi.mocked(calculatePriceDetailed).mockReset();
  vi.mocked(getCalendar).mockReset();
});

describe("§3.2 rodada 19 — indisponibilidade tem três saídas distintas", () => {
  it("ocupado nesta casa e livre na outra: oferece a outra casa nas MESMAS datas", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue(recusa("unavailable-day"));
    vi.mocked(getCalendar).mockImplementation(
      calendarioCom({ [SOL1]: [CHECKIN, "2026-09-12"] }) as never,
    );

    const r = await calcularPacoteServer(entrada("solarium-1"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Solarium 1");
    expect(r.erro).not.toContain("concierge");
    expect(r.alternativa?.rotulo).toBe("Ver no Solarium 2");

    // As datas pedidas têm de sobreviver ao link — trocar de casa não pode
    // custar ao hóspede reescolher o período.
    const url = new URL(r.alternativa!.href, "https://x.test");
    expect(url.pathname).toBe(`/pacotes/${PACOTE.slug}`);
    expect(url.searchParams.get("checkin")).toBe(CHECKIN);
    expect(url.searchParams.get("checkout")).toBe(CHECKOUT);
    expect(url.searchParams.get("casa")).toBe("solarium-2");
  });

  it("ocupado nas duas casas: oferece a próxima data livre do mesmo pacote", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue(recusa("unavailable-day"));
    // Fim de semana pedido bloqueado nas duas; o seguinte, livre.
    vi.mocked(getCalendar).mockImplementation(
      calendarioCom({
        [SOL1]: [CHECKIN, "2026-09-12"],
        [SOL2]: [CHECKIN, "2026-09-12"],
      }) as never,
    );

    const r = await calcularPacoteServer(entrada("solarium-1"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("reservadas");
    expect(r.alternativa).toBeTruthy();

    const url = new URL(r.alternativa!.href, "https://x.test");
    const checkin = url.searchParams.get("checkin")!;
    const checkout = url.searchParams.get("checkout")!;

    // A data oferecida é posterior, elegível e não é a que acabou de falhar.
    expect(checkin > CHECKIN).toBe(true);
    expect(new Date(checkin + "T12:00:00").getDay()).toBe(5); // sexta
    expect(new Date(checkout + "T12:00:00").getDay()).toBe(0); // domingo
  });

  it("calendário fora do ar: fala de falha técnica e não inventa alternativa", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue(recusa("api-error"));
    vi.mocked(getCalendar).mockRejectedValue(new Error("timeout"));

    const r = await calcularPacoteServer(entrada("solarium-1"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("Tente de novo");
    expect(r.alternativa).toBeUndefined();
  });

  it("noites livres mas sem preço: continua sendo falha técnica", async () => {
    vi.mocked(calculatePriceDetailed).mockResolvedValue(recusa("api-error"));
    vi.mocked(getCalendar).mockImplementation(calendarioCom({}) as never);

    const r = await calcularPacoteServer(entrada("solarium-1"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.alternativa).toBeUndefined();
  });

  it("mínimo de noites da chegada: diz o número e oferece a saída que fecha", async () => {
    // A tarifa da chegada exige 4 noites; o cliente pediu 2.
    vi.mocked(calculatePriceDetailed).mockResolvedValue(
      recusa("min-stay-not-met", { minimumStay: 4, requested: 2 }),
    );
    vi.mocked(getCalendar).mockImplementation(calendarioCom({}) as never);

    const r = await calcularPacoteServer(entrada("solarium-1"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(200);
    expect(r.erro).toContain("4 noites");
    expect(r.erro).not.toContain("Tente de novo");
    // A saída de 4 noites cai numa terça, que este pacote não aceita: sem
    // alternativa inventada.
    expect(r.alternativa).toBeUndefined();
  });
});
