import { describe, expect, it } from "vitest";
import type { Foto } from "@/config/galeria";
import {
  ambientesDisponiveis,
  estadoInicialDoDeepLink,
  filtrarPorAmbiente,
  fotosDoMosaico,
  indiceDaFoto,
  ordenarFotos,
  vizinhas,
} from "@/lib/galeria/consulta";

function foto(over: Partial<Foto> & { id: string }): Foto {
  return {
    publicId: `solarium/casas/solarium-1/${over.id}`,
    alt: `descrição de ${over.id}`,
    ambiente: "spa",
    estacao: "indiferente",
    largura: 1200,
    altura: 1600,
    ordem: 1,
    destaque: false,
    ...over,
  };
}

const ACERVO: Foto[] = [
  foto({ id: "c", ordem: 3, ambiente: "cinema", destaque: true }),
  foto({ id: "a", ordem: 1, ambiente: "spa", destaque: true }),
  foto({ id: "d", ordem: 4, ambiente: "spa" }),
  foto({ id: "b", ordem: 2, ambiente: "vista", destaque: true }),
  foto({ id: "e", ordem: 5, ambiente: "cinema", destaque: true }),
  foto({ id: "f", ordem: 6, ambiente: "vista", destaque: true }),
  foto({ id: "g", ordem: 7, ambiente: "quarto", destaque: true }),
];

describe("ordenarFotos", () => {
  it("ordena por 'ordem', não pela posição no arquivo", () => {
    expect(ordenarFotos(ACERVO).map((f) => f.id)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("não muta a lista recebida", () => {
    const copia = [...ACERVO];
    ordenarFotos(ACERVO);
    expect(ACERVO).toEqual(copia);
  });

  it("desempata por id para a ordem ser estável", () => {
    const empate = [foto({ id: "z", ordem: 1 }), foto({ id: "y", ordem: 1 })];
    expect(ordenarFotos(empate).map((f) => f.id)).toEqual(["y", "z"]);
  });
});

describe("fotosDoMosaico", () => {
  it("leva as 5 primeiras marcadas como destaque", () => {
    expect(fotosDoMosaico(ACERVO).map((f) => f.id)).toEqual(["a", "b", "c", "e", "f"]);
  });

  it("cai para as primeiras da ordem quando ninguém foi destacado", () => {
    const semDestaque = ACERVO.map((f) => ({ ...f, destaque: false }));
    expect(fotosDoMosaico(semDestaque).map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("devolve menos de 5 se o acervo for menor, sem quebrar", () => {
    expect(fotosDoMosaico(ACERVO.slice(0, 2))).toHaveLength(2);
  });
});

describe("filtrarPorAmbiente", () => {
  it("sem filtro devolve tudo, em ordem", () => {
    expect(filtrarPorAmbiente(ACERVO, null)).toHaveLength(ACERVO.length);
  });

  it("filtra pelo ambiente pedido", () => {
    expect(filtrarPorAmbiente(ACERVO, "spa").map((f) => f.id)).toEqual(["a", "d"]);
    expect(filtrarPorAmbiente(ACERVO, "cinema").map((f) => f.id)).toEqual(["c", "e"]);
  });

  it("mantém a ordem dentro do filtro", () => {
    expect(filtrarPorAmbiente(ACERVO, "vista").map((f) => f.ordem)).toEqual([2, 6]);
  });

  it("ambiente sem foto devolve lista vazia, não a lista inteira", () => {
    expect(filtrarPorAmbiente(ACERVO, "cozinha")).toEqual([]);
  });
});

describe("ambientesDisponiveis", () => {
  it("lista sem repetir, na ordem em que aparecem", () => {
    expect(ambientesDisponiveis(ACERVO)).toEqual(["spa", "vista", "cinema", "quarto"]);
  });
});

describe("deep-link ?foto={id}", () => {
  it("resolve o id para a posição na galeria", () => {
    expect(estadoInicialDoDeepLink(ACERVO, "c")).toEqual({ indice: 2, ambiente: null });
  });

  it("abre a primeira foto quando o link aponta para ela", () => {
    expect(estadoInicialDoDeepLink(ACERVO, "a")?.indice).toBe(0);
  });

  it("id inexistente não abre a lightbox numa foto arbitrária", () => {
    expect(estadoInicialDoDeepLink(ACERVO, "foto-que-foi-removida")).toBeNull();
  });

  it("ausência do parâmetro não abre nada", () => {
    expect(estadoInicialDoDeepLink(ACERVO, null)).toBeNull();
    expect(estadoInicialDoDeepLink(ACERVO, undefined)).toBeNull();
    expect(estadoInicialDoDeepLink(ACERVO, "")).toBeNull();
  });

  it("entra sem filtro para o link nunca cair fora do recorte ativo", () => {
    expect(estadoInicialDoDeepLink(ACERVO, "g")?.ambiente).toBeNull();
  });
});

describe("indiceDaFoto", () => {
  it("devolve -1 para id ausente", () => {
    expect(indiceDaFoto(ACERVO, "nao-existe")).toBe(-1);
    expect(indiceDaFoto(ACERVO, null)).toBe(-1);
  });

  it("respeita o recorte do filtro", () => {
    const spa = filtrarPorAmbiente(ACERVO, "spa");
    expect(indiceDaFoto(spa, "d")).toBe(1);
    expect(indiceDaFoto(spa, "c")).toBe(-1);
  });
});

describe("vizinhas (preload da anterior e da próxima)", () => {
  it("dá a volta nas duas pontas", () => {
    expect(vizinhas(5, 0)).toEqual({ anterior: 4, proxima: 1 });
    expect(vizinhas(5, 4)).toEqual({ anterior: 3, proxima: 0 });
  });

  it("com uma foto só, ambas apontam para ela mesma", () => {
    expect(vizinhas(1, 0)).toEqual({ anterior: 0, proxima: 0 });
  });

  it("lista vazia não gera índice inválido", () => {
    expect(vizinhas(0, 0)).toEqual({ anterior: -1, proxima: -1 });
  });
});
