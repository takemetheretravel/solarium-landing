import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GaleriaProvider from "@/components/galeria/GaleriaProvider";
import Mosaico from "@/components/galeria/Mosaico";
import GaleriaPorAmbiente from "@/components/galeria/GaleriaPorAmbiente";
import ImagemGaleria from "@/components/galeria/ImagemGaleria";
import {
  urlGaleria,
  ordenarPorEstacao,
  carregarGaleria,
  podeAparecer,
  porAmbiente,
  destaque,
  buscarPorArquivo,
  montarGaleriaDaCasa,
  podeSerVitrine,
  type ItemGaleria,
} from ".";

const RAIZ = path.resolve(__dirname, "../../..");
const CASAS = ["solarium-1", "solarium-2", "solarium-completo"];
const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

function item(p: Partial<ItemGaleria>): ItemGaleria {
  return {
    arquivo: "x/a.jpg", largura: 10, altura: 10, alt: "alt", ambiente: "vista", estacao: "neutra",
    destaque: false, ordem: 1, tambemEm: [], baixaResolucao: false, excluirDoSite: false,
    creditoPendente: false, marcaDagua: false, telaComConteudo: false, ...p,
  };
}

describe("IMG-1a — urlGaleria", () => {
  it("usa o projeto do ambiente e codifica cada segmento", () => {
    expect(urlGaleria("solarium-1/spa/a b.jpg")).toBe(
      "https://exemplo.supabase.co/storage/v1/object/public/galerias/solarium-1/spa/a%20b.jpg",
    );
  });
});

describe("IMG-1a — ordenarPorEstacao", () => {
  const lista = [
    item({ arquivo: "v/1", ambiente: "vista", estacao: "seca", ordem: 1 }),
    item({ arquivo: "v/2", ambiente: "vista", estacao: "neutra", ordem: 2 }),
    item({ arquivo: "v/3", ambiente: "vista", estacao: "verde", ordem: 3 }),
    item({ arquivo: "q/4", ambiente: "quarto", estacao: "seca", ordem: 4 }),
    item({ arquivo: "v/5", ambiente: "vista", estacao: "verde", ordem: 5 }),
  ];
  const ids = (l: ItemGaleria[]) => l.map((i) => i.arquivo);

  it.each([10, 11, 12, 1, 2, 3])("mês %i: verde antes de seca, neutra parada", (mes) => {
    expect(ids(ordenarPorEstacao(lista, mes))).toEqual(["v/3", "v/2", "v/5", "q/4", "v/1"]);
  });

  it.each([4, 5, 6, 7, 8, 9])("mês %i: seca antes de verde, neutra parada", (mes) => {
    expect(ids(ordenarPorEstacao(lista, mes))).toEqual(["v/1", "v/2", "v/3", "q/4", "v/5"]);
  });

  it("não perde nem duplica item", () => {
    for (const m of MESES) expect(ordenarPorEstacao(lista, m).map((i) => i.arquivo).sort()).toEqual(ids(lista).sort());
  });
});

describe("IMG-1a — o que aparece", () => {
  it("excluirDoSite nunca; crédito pendente só com crédito", () => {
    expect(podeAparecer(item({ excluirDoSite: true }))).toBe(false);
    expect(podeAparecer(item({ creditoPendente: true }))).toBe(false);
    expect(podeAparecer(item({ creditoPendente: true, credito: "Fulano" }))).toBe(true);
    for (const g of ["solarium-1", "solarium-2", "completo", "experiencias"] as const) {
      expect(carregarGaleria(g).every(podeAparecer)).toBe(true);
    }
  });

  it("capa de cada casa pode ser vitrine", () => {
    for (const g of ["solarium-1", "solarium-2", "completo"] as const) {
      const d = destaque(g);
      expect(d, g).toBeDefined();
      expect(podeSerVitrine(d!)).toBe(true);
    }
  });

  it("buscarPorArquivo acha em qualquer manifesto", () => {
    const capa = destaque("solarium-2")!;
    expect(buscarPorArquivo(capa.arquivo)).toEqual(capa);
    expect(buscarPorArquivo("nao/existe.jpg")).toBeUndefined();
  });
});

describe("IMG-1a — chips por ambiente", () => {
  it("ordem fixa; cinema só no Solarium 2", () => {
    const r1 = porAmbiente(carregarGaleria("solarium-1")).map((c) => c.rotulo);
    const r2 = porAmbiente(carregarGaleria("solarium-2")).map((c) => c.rotulo);
    const ordem = ["Vista e SPA", "Quarto", "Cinema", "Cozinha e área gourmet", "Área externa", "Sala e rede", "Banheiros"];
    for (const r of [r1, r2]) expect(r).toEqual(ordem.filter((o) => r.includes(o)));
    expect(r1).not.toContain("Cinema");
    expect(r2).toContain("Cinema");
  });

  it("agrupa vista, amanhecer e spa em Vista e SPA; nada se perde", () => {
    const todas = carregarGaleria("solarium-1");
    const cats = porAmbiente(todas);
    const vistaSpa = cats.find((c) => c.rotulo === "Vista e SPA")!.itens;
    expect(new Set(vistaSpa.map((i) => i.ambiente))).toEqual(new Set(["vista", "amanhecer", "spa"]));
    expect(cats.flatMap((c) => c.itens).length).toBe(todas.length);
  });
});

describe.each(CASAS)("IMG-1a — página de %s", (slug) => {
  it.each(MESES)("mês %i: hero, mosaico e grade sem foto repetida; tudo que é visível aparece uma vez", (mes) => {
    const g = montarGaleriaDaCasa(slug, mes);
    const naPagina = [g.hero, ...g.mosaico, ...g.categorias.flatMap((c) => c.itens)].map((i) => i.arquivo);
    expect(new Set(naPagina).size).toBe(naPagina.length);
    expect(new Set(naPagina)).toEqual(new Set(g.todas.map((i) => i.arquivo)));
  });

  it("hero e mosaico só com fotos que podem ser vitrine; mosaico com 5", () => {
    const g = montarGaleriaDaCasa(slug);
    expect(g.mosaico).toHaveLength(5);
    for (const i of [g.hero, ...g.mosaico]) expect(podeSerVitrine(i), i.arquivo).toBe(true);
  });

  it("todo item tem alt e nenhum é excluído", () => {
    for (const i of montarGaleriaDaCasa(slug).todas) {
      expect(i.alt.trim(), i.arquivo).not.toBe("");
      expect(i.excluirDoSite).toBe(false);
    }
  });

  it("renderizado: nenhuma <img> repetida, todas com alt, nenhuma excluída", () => {
    const g = montarGaleriaDaCasa(slug);
    const html = renderToStaticMarkup(
      createElement(GaleriaProvider, {
        todas: g.todas,
        children: [
          createElement(ImagemGaleria, { key: "h", item: g.hero, sizes: "100vw", priority: true }),
          createElement(Mosaico, { key: "m", itens: g.mosaico }),
          createElement(GaleriaPorAmbiente, { key: "g", categorias: g.categorias }),
        ],
      }),
    );
    const imgs = Array.from(html.matchAll(/<img\b[^>]*>/g)).map(([t]) => t);
    expect(imgs.length).toBeGreaterThan(5);
    const origem = (tag: string) => decodeURIComponent(/url=([^&"]+)/.exec(tag)?.[1] ?? /src="([^"]+)"/.exec(tag)![1]);
    const srcs = imgs.map(origem);
    expect(new Set(srcs).size).toBe(srcs.length);
    for (const t of imgs) expect(/alt="([^"]+)"/.exec(t)?.[1]?.trim(), t).toBeTruthy();
    const excluidas = new Set(
      ["solarium-1", "solarium-2", "completo"].flatMap((m) =>
        (JSON.parse(fs.readFileSync(path.join(RAIZ, `content/galerias/${m}.json`), "utf8")) as ItemGaleria[])
          .filter((i) => i.excluirDoSite)
          .map((i) => urlGaleria(i.arquivo)),
      ),
    );
    for (const s of srcs) expect(excluidas.has(s), s).toBe(false);
  });
});

describe("IMG-1a — página de casa no código", () => {
  const fonte = fs.readFileSync(path.join(RAIZ, "src/app/(site)/[propertyId]/page.tsx"), "utf8");

  it("não usa mais galleryImages nem heroImage (galeria duplicada e hero repetido)", () => {
    expect(fonte).not.toMatch(/galleryImages|heroImage|SOLARIUM_COMPLETO_GALLERY_GROUPS/);
  });

  it("monta tudo a partir do manifesto", () => {
    expect(fonte).toMatch(/montarGaleriaDaCasa\(/);
    expect(fonte).toMatch(/<Mosaico /);
    expect(fonte).toMatch(/<GaleriaPorAmbiente /);
  });

  it("nenhum componente de galeria monta URL de imagem na mão", () => {
    const dir = path.join(RAIZ, "src/components/galeria");
    for (const f of fs.readdirSync(dir)) {
      const s = fs.readFileSync(path.join(dir, f), "utf8");
      expect(s, f).not.toMatch(/supabase\.co|storage\/v1/);
    }
  });
});
