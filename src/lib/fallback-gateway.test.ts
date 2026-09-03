import { describe, it, expect, vi, beforeEach } from "vitest";

// Só a camada de persistência é falsa. A regra de decisão é a de produção.
vi.mock("@/lib/kv-store", () => ({
  updateDraft: vi.fn(),
  registrarBloqueioAntifraude: vi.fn(),
}));

import { updateDraft, registrarBloqueioAntifraude } from "@/lib/kv-store";
import { registrarBloqueioEAvaliarFallback, BLOQUEIOS_ATE_FALLBACK } from "./fallback-gateway";

const DRAFT = "861734d3-929c-4bf4-af67-5ff1f39a2b9b";

beforeEach(() => {
  vi.mocked(updateDraft).mockReset().mockResolvedValue(undefined);
  vi.mocked(registrarBloqueioAntifraude).mockReset();
});

/**
 * Reconstrução do incidente de 28/08: seis bloqueios de antifraude no mesmo
 * draft, todos com o emissor tendo autorizado. O hóspede foi deixado sozinho e
 * só concluiu 44 minutos depois, migrando à mão para a Cielo.
 */
describe("contador de bloqueios AF e virada para a Cielo", () => {
  it("o PRIMEIRO bloqueio não muda nada — a Braspag continua primária", async () => {
    vi.mocked(registrarBloqueioAntifraude).mockResolvedValue(1);

    const r = await registrarBloqueioEAvaliarFallback(DRAFT);

    expect(r.bloqueios).toBe(1);
    expect(r.fallbackDisponivel).toBe(false);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("o SEGUNDO bloqueio marca o draft para a Cielo", async () => {
    vi.mocked(registrarBloqueioAntifraude).mockResolvedValue(2);

    const r = await registrarBloqueioEAvaliarFallback(DRAFT);

    expect(r.bloqueios).toBe(2);
    expect(r.fallbackDisponivel).toBe(true);
    expect(updateDraft).toHaveBeenCalledWith(DRAFT, { provider_forcado: "cielo" });
  });

  it("do segundo em diante segue marcando — idempotente, mesmo valor", async () => {
    for (const n of [3, 4, 5, 6]) {
      vi.mocked(registrarBloqueioAntifraude).mockResolvedValue(n);
      const r = await registrarBloqueioEAvaliarFallback(DRAFT);
      expect(r.fallbackDisponivel).toBe(true);
      expect(updateDraft).toHaveBeenLastCalledWith(DRAFT, { provider_forcado: "cielo" });
    }
  });

  it("o corte é exatamente em 2", () => {
    expect(BLOQUEIOS_ATE_FALLBACK).toBe(2);
  });

  it("contador indisponível (Redis fora) NÃO troca de gateway", async () => {
    // `registrarBloqueioAntifraude` devolve 0 quando o Redis falha. Sem contador
    // confiável, o conservador é não trocar: mandar o hóspede para a Cielo por
    // engano é pior que deixá-lo tentar de novo na Braspag.
    vi.mocked(registrarBloqueioAntifraude).mockResolvedValue(0);

    const r = await registrarBloqueioEAvaliarFallback(DRAFT);

    expect(r.fallbackDisponivel).toBe(false);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("nunca lança — é chamada dentro do caminho de recusa", async () => {
    vi.mocked(registrarBloqueioAntifraude).mockRejectedValue(new Error("redis fora"));

    await expect(registrarBloqueioEAvaliarFallback(DRAFT)).resolves.toEqual({
      bloqueios: 0,
      fallbackDisponivel: false,
    });
  });

  it("falha ao gravar o draft não derruba a rota", async () => {
    vi.mocked(registrarBloqueioAntifraude).mockResolvedValue(2);
    vi.mocked(updateDraft).mockRejectedValue(new Error("redis fora"));

    const r = await registrarBloqueioEAvaliarFallback(DRAFT);
    expect(r.fallbackDisponivel).toBe(false);
  });
});
