import { describe, expect, it } from "vitest";
import {
  AMBIENTES,
  MANIFESTOS_POR_CASA,
  fotoPorId,
  fotosDaCasa,
  validarManifesto,
} from "@/config/galeria";

const CASAS = ["solarium-1", "solarium-2", "solarium-completo"] as const;

function manifestoValido() {
  return {
    casa: "solarium-1",
    fotos: [
      {
        id: "a",
        publicId: "solarium/casas/solarium-1/a",
        alt: "Uma descrição de verdade",
        ambiente: "spa",
        estacao: "indiferente",
        largura: 1200,
        altura: 1600,
        ordem: 1,
        destaque: true,
        blurDataURL: "data:image/jpeg;base64,AAA",
      },
    ],
  };
}

describe("schema do manifesto", () => {
  it("aceita um manifesto bem formado", () => {
    expect(() => validarManifesto(manifestoValido(), "teste")).not.toThrow();
  });

  it("recusa foto sem texto alternativo", () => {
    const m = manifestoValido();
    m.fotos[0].alt = "";
    expect(() => validarManifesto(m, "teste")).toThrow(/alt/);
  });

  it("recusa ambiente fora do enum", () => {
    const m = manifestoValido();
    m.fotos[0].ambiente = "piscina-secreta";
    expect(() => validarManifesto(m, "teste")).toThrow(/ambiente/);
  });

  it("recusa estacao fora do enum", () => {
    const m = manifestoValido();
    m.fotos[0].estacao = "outono";
    expect(() => validarManifesto(m, "teste")).toThrow(/estacao/);
  });

  it("recusa dimensao ausente ou zerada", () => {
    const m = manifestoValido();
    m.fotos[0].largura = 0;
    expect(() => validarManifesto(m, "teste")).toThrow(/largura/);
  });

  it("recusa manifesto sem nenhuma foto", () => {
    expect(() => validarManifesto({ casa: "solarium-1", fotos: [] }, "teste")).toThrow();
  });

  it("recusa ids repetidos", () => {
    const m = manifestoValido();
    m.fotos.push({ ...m.fotos[0], ordem: 2 });
    expect(() => validarManifesto(m, "teste")).toThrow(/ids repetidos/);
  });

  it("recusa 'ordem' repetida — a sequência ficaria ambígua", () => {
    const m = manifestoValido();
    m.fotos.push({ ...m.fotos[0], id: "b", publicId: "solarium/casas/solarium-1/b" });
    expect(() => validarManifesto(m, "teste")).toThrow(/ordem/);
  });

  it("aponta o arquivo de origem na mensagem de erro", () => {
    const m = manifestoValido();
    m.fotos[0].alt = "";
    expect(() => validarManifesto(m, "content/galerias/x.json")).toThrow(
      /content\/galerias\/x\.json/,
    );
  });
});

describe("manifestos versionados no repositório", () => {
  it.each(CASAS)("%s passa pelo schema", (casa) => {
    expect(MANIFESTOS_POR_CASA[casa].fotos.length).toBeGreaterThan(0);
  });

  it.each(CASAS)("%s vem ordenado por 'ordem', sem buracos", (casa) => {
    const fotos = fotosDaCasa(casa);
    expect(fotos.map((f) => f.ordem)).toEqual(fotos.map((_, i) => i + 1));
  });

  it.each(CASAS)("%s tem destaques suficientes para o mosaico de 5", (casa) => {
    expect(fotosDaCasa(casa).filter((f) => f.destaque).length).toBeGreaterThanOrEqual(5);
  });

  it.each(CASAS)("%s descreve toda foto com alt utilizável", (casa) => {
    for (const foto of fotosDaCasa(casa)) {
      expect(foto.alt.length).toBeGreaterThan(10);
      expect(AMBIENTES).toContain(foto.ambiente);
    }
  });

  it.each(CASAS)("%s aponta só para publicId do Cloudinary", (casa) => {
    for (const foto of fotosDaCasa(casa)) {
      expect(foto.publicId.startsWith("solarium/")).toBe(true);
      expect(foto.publicId).not.toMatch(/^https?:/);
    }
  });

  it.each(CASAS)("%s embute blurDataURL como data URI", (casa) => {
    for (const foto of fotosDaCasa(casa)) {
      expect(foto.blurDataURL).toMatch(/^data:image\/jpeg;base64,/);
    }
  });

  it("solarium-completo agrega as duas casas além das fotos do conjunto", () => {
    const ids = fotosDaCasa("solarium-completo").map((f) => f.id);
    expect(ids.some((i) => i.startsWith("solarium-1-"))).toBe(true);
    expect(ids.some((i) => i.startsWith("solarium-2-"))).toBe(true);
    expect(ids.some((i) => i.startsWith("solarium-completo-"))).toBe(true);
  });

  it("a página do Completo abre pelas fotos do conjunto, não pelas da casa 1", () => {
    const primeira = fotosDaCasa("solarium-completo")[0];
    expect(primeira.id.startsWith("solarium-completo-")).toBe(true);
  });

  it("fotoPorId encontra e devolve undefined para id inexistente", () => {
    const alvo = fotosDaCasa("solarium-1")[2];
    expect(fotoPorId("solarium-1", alvo.id)?.publicId).toBe(alvo.publicId);
    expect(fotoPorId("solarium-1", "nao-existe")).toBeUndefined();
  });
});
