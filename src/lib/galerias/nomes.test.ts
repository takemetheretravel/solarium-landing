import { describe, it, expect } from "vitest";
import {
  slug,
  normalizarAmbiente,
  prioridadeAmbiente,
  descricaoDoNomeOriginal,
  nomeFinal,
  contemNomeDePessoa,
} from "../../../scripts/galerias/nomes";

describe("IMG-0 — regras de nome", () => {
  it("slug: minúsculas, sem acento, hífen", () => {
    expect(slug("Área Gourmet à Noite")).toBe("area-gourmet-a-noite");
    expect(slug("  Pôr do Sol!! (1) ")).toBe("por-do-sol-1");
  });

  it.each([
    ["area gourmet", "area-gourmet"],
    ["banheiro_suíte", "banheiro-suite"],
    ["banheiro_social", "banheiro-social"],
    ["Banheiro", "banheiro"],
    [null, "geral"],
  ])("ambiente %s → %s", (pasta, esperado) => {
    expect(normalizarAmbiente(pasta)).toBe(esperado);
  });

  it("prioridade: spa vence vista e amanhecer; banheiro-* vale como banheiro", () => {
    expect(prioridadeAmbiente("spa")).toBeLessThan(prioridadeAmbiente("vista"));
    expect(prioridadeAmbiente("vista")).toBeLessThan(prioridadeAmbiente("amanhecer"));
    expect(prioridadeAmbiente("rede")).toBeLessThan(prioridadeAmbiente("vista"));
    expect(prioridadeAmbiente("banheiro-suite")).toBe(prioridadeAmbiente("banheiro"));
    expect(prioridadeAmbiente("amanhecer")).toBeLessThan(prioridadeAmbiente("geral"));
  });

  it.each([
    ["Cópia de Ret_Solarium 1_Área gourmet(1).jpg", "area-gourmet"],
    ["Cópia de Solarium 1_Banheira Aline.jpg", "banheira"],
    ["Cópia de Solarium 2_Quarto e banheira Guilherme.jpg", "quarto-e-banheira"],
    ["Cópia de Ret_Solarium 1_Quarto Elora.JPG", "quarto"],
    ["Cópia de Ret_Solarium 1_Grávida na poltrona.jpg", "leitura-na-poltrona"],
    ["Cópia de Ret_Solarium 1_Amenities.JPG", "itens-de-banho"],
    ["Cópia de Solarium Completo_Frentes Pôr do sol.jpg", "frentes-por-do-sol"],
    ["Cópia de Sessão de Massagem_Silvana_Deck Solarium 2.jpg", "sessao-de-massagem-deck-solarium-2"],
  ])("descrição provisória de %s", (original, esperado) => {
    expect(descricaoDoNomeOriginal(original)).toBe(esperado);
  });

  it("nome final: slug estável, sem prefixo de ordem; colisão ganha -2, -3", () => {
    const usados = new Set<string>();
    expect(nomeFinal("solarium-1/spa", "SPA vidro aberto", "jpg", usados)).toBe("spa-vidro-aberto.jpg");
    expect(nomeFinal("solarium-1/spa", "spa vidro aberto", "jpg", usados)).toBe("spa-vidro-aberto-2.jpg");
    expect(nomeFinal("solarium-1/spa", "SPA-vidro-aberto", "jpg", usados)).toBe("spa-vidro-aberto-3.jpg");
    // Outra pasta não colide.
    expect(nomeFinal("solarium-2/spa", "SPA vidro aberto", "jpg", usados)).toBe("spa-vidro-aberto.jpg");
  });

  it("detecta nome de pessoa em qualquer segmento", () => {
    expect(contemNomeDePessoa("solarium-2/spa/05-banheira-guilherme.jpg")).toBe("guilherme");
    expect(contemNomeDePessoa("solarium-1/rede/05-cafe-na-rede.jpg")).toBeNull();
    // "alinea" não é "aline"
    expect(contemNomeDePessoa("x/01-alinea.jpg")).toBeNull();
  });
});
