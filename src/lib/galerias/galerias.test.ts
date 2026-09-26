import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GaleriaProvider from "@/components/galeria/GaleriaProvider";
import Mosaico from "@/components/galeria/Mosaico";
import GaleriaPorAmbiente from "@/components/galeria/GaleriaPorAmbiente";
import ImagemGaleria, { ImagemInteira } from "@/components/galeria/ImagemGaleria";
import {
  urlGaleria,
  ordenarPorEstacao,
  carregarGaleria,
  podeAparecer,
  porAmbiente,
  chipsDoItem,
  AJUSTES,
  CATEGORIAS,
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

  it("agrupa vista, amanhecer e spa em Vista e SPA; toda foto visível está em algum chip", () => {
    const todas = carregarGaleria("solarium-1");
    const cats = porAmbiente(todas);
    const vistaSpa = cats.find((c) => c.rotulo === "Vista e SPA")!.itens;
    expect(vistaSpa.some((i) => i.ambiente === "spa")).toBe(true);
    expect(vistaSpa.some((i) => i.ambiente === "vista")).toBe(true);
    const emAlgum = new Set(cats.flatMap((c) => c.itens.map((i) => i.arquivo)));
    for (const i of todas) expect(emAlgum.has(i.arquivo), i.arquivo).toBe(true);
    for (const c of cats) expect(new Set(c.itens.map((i) => i.arquivo)).size, c.rotulo).toBe(c.itens.length);
  });

  it("uma foto pode estar em mais de um chip (tambemEm)", () => {
    const i = carregarGaleria("solarium-1").find((x) => x.arquivo.endsWith("spa-e-rede-suspensa-vista-serra.jpg"))!;
    expect(chipsDoItem(i)).toEqual(expect.arrayContaining(["vista-spa", "sala-rede"]));
  });
});

describe.each(CASAS)("IMG-1a — página de %s", (slug) => {
  it.each(MESES)("mês %i: hero e mosaico sem repetição; toda foto visível aparece na grade", (mes) => {
    const g = montarGaleriaDaCasa(slug, mes);
    const topo = [g.hero, ...g.mosaico].map((i) => i.arquivo);
    expect(new Set(topo).size).toBe(topo.length);
    const naGrade = new Set(g.categorias.flatMap((c) => c.itens.map((i) => i.arquivo)));
    for (const i of g.todas) expect(naGrade.has(i.arquivo), i.arquivo).toBe(true);
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

  it("renderizado: hero e mosaico sem <img> repetida; todas com alt, nenhuma excluída", () => {
    const g = montarGaleriaDaCasa(slug);
    const html = renderToStaticMarkup(
      createElement(GaleriaProvider, {
        todas: g.todas,
        children: [
          createElement(ImagemGaleria, { key: "h", item: g.hero, sizes: "100vw", priority: true }),
          createElement(Mosaico, { key: "m", itens: g.mosaico }),
        ],
      }),
    );
    const grade = renderToStaticMarkup(
      createElement(GaleriaProvider, { todas: g.todas, children: createElement(GaleriaPorAmbiente, { categorias: g.categorias }) }),
    );
    const tags = (h: string) => Array.from(h.matchAll(/<img\b[^>]*>/g)).map(([t]) => t);
    const origem = (tag: string) => decodeURIComponent(/url=([^&"]+)/.exec(tag)?.[1] ?? /src="([^"]+)"/.exec(tag)![1]);
    const topo = tags(html).map(origem);
    expect(topo.length).toBe(6);
    expect(new Set(topo).size).toBe(topo.length);
    const imgs = [...tags(html), ...tags(grade)];
    const srcs = imgs.map(origem);
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

describe("IMG-1a-ajustes — ajustes manuais", () => {
  const todosArquivos = new Set(
    ["solarium-1", "solarium-2", "completo", "experiencias", "comum"].flatMap((g) =>
      (JSON.parse(fs.readFileSync(path.join(RAIZ, `content/galerias/${g}.json`), "utf8")) as ItemGaleria[]).map((i) => i.arquivo),
    ),
  );
  const idsValidos = new Set(CATEGORIAS.map((c) => c.id));

  it("toda chave existe num manifesto e todo chip é válido", () => {
    for (const [arquivo, a] of Object.entries(AJUSTES)) {
      expect(todosArquivos.has(arquivo), arquivo).toBe(true);
      for (const amb of a.ambientes ?? []) expect(idsValidos.has(amb), `${arquivo}: ${amb}`).toBe(true);
      expect(Object.keys(a).every((k) => ["incluir", "excluir", "ambientes", "ordem"].includes(k)), arquivo).toBe(true);
      expect(a.incluir && a.excluir, arquivo).toBeFalsy();
    }
  });

  it("incluir traz de volta foto excluída; excluir tira", () => {
    // Testado pela função pública: podeAparecer depois do ajuste.
    const excluida = (JSON.parse(fs.readFileSync(path.join(RAIZ, "content/galerias/solarium-1.json"), "utf8")) as ItemGaleria[]).find(
      (i) => i.excluirDoSite,
    )!;
    expect(carregarGaleria("solarium-1").some((i) => i.arquivo === excluida.arquivo)).toBe(Boolean(AJUSTES[excluida.arquivo]?.incluir));
  });

  it("Solarium 2 → Vista e SPA tem o SPA ao lado da cama e não tem notebook nem fachada", () => {
    const vistaSpa = porAmbiente(carregarGaleria("solarium-2")).find((c) => c.id === "vista-spa")!.itens.map((i) => i.arquivo);
    for (const f of ["spa-de-imersao-ao-por-do-sol", "cama-diante-do-spa", "teto-retratil-aberto-sobre-o-spa", "quarto-e-spa-ao-por-do-sol"]) {
      expect(vistaSpa.some((a) => a.endsWith(`/${f}.jpg`)), f).toBe(true);
    }
    expect(vistaSpa.some((a) => a.includes("home-office"))).toBe(false);
    expect(vistaSpa.some((a) => a.includes("fachada"))).toBe(false);
  });

  it.each(["solarium-1", "solarium-2"] as const)("%s: Banheiros com até 6 fotos (inclusões manuais não contam)", (g) => {
    const ban = porAmbiente(carregarGaleria(g)).find((c) => c.id === "banheiro")!.itens;
    expect(ban.filter((i) => !AJUSTES[i.arquivo]?.incluir).length).toBeLessThanOrEqual(6);
    expect(ban.length).toBeGreaterThan(3);
  });
});

describe("IMG-1a-ajustes — lightbox sem corte e por cima de tudo", () => {
  const ler = (f: string) => fs.readFileSync(path.join(RAIZ, f), "utf8");

  it("foto inteira: proporção do manifesto, contain, sizes 100vw — nunca cover", () => {
    const item = destaque("solarium-1")!;
    const html = renderToStaticMarkup(createElement(ImagemInteira, { item, alturaMaxima: "80vh" }));
    expect(html).toContain(`width="${item.largura}"`);
    expect(html).toContain(`height="${item.altura}"`);
    expect(html).toMatch(/object-fit:contain/);
    expect(html).toContain('sizes="100vw"');
    expect(ler("src/components/galeria/Lightbox.tsx")).not.toMatch(/cover/);
  });

  it("portal no body, z-index acima de tudo, fundo opaco Preto Serra, esconde flutuantes", () => {
    const lb = ler("src/components/galeria/Lightbox.tsx");
    expect(lb).toMatch(/createPortal\(/);
    expect(lb).toMatch(/#111111/);
    expect(lb).toMatch(/z-\[2147483000\]/);
    expect(ler("src/components/ui/FloatingWhatsApp.tsx")).toMatch(/data-esconder-no-lightbox/);
    expect(ler("src/components/booking/MobileBookingBar.tsx")).toMatch(/data-esconder-no-lightbox/);
    expect(ler("src/app/globals.css")).toMatch(/body\.lightbox-aberto \[data-esconder-no-lightbox\]/);
  });

  it("miniatura respeita o foco do manifesto", () => {
    const item = { ...destaque("solarium-1")!, foco: "esquerda" as const };
    const html = renderToStaticMarkup(createElement(ImagemGaleria, { item, sizes: "50vw" }));
    expect(html).toMatch(/object-position:left center/);
  });
});

describe("IMG-1a-ajustes — verificação do Search Console", () => {
  const ARQ = "google017462615c616c47.html";

  it("arquivo em public/ com o texto exato, sem quebra de linha", () => {
    expect(fs.readFileSync(path.join(RAIZ, "public", ARQ), "utf8")).toBe(`google-site-verification: ${ARQ}`);
  });

  it("nenhum middleware nem redirect intercepta a rota", () => {
    const mw = fs.readFileSync(path.join(RAIZ, "src/middleware.ts"), "utf8");
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(mw)![1];
    expect(matcher).not.toMatch(/google|\(\.\*\)|:path\*/);
    const cfg = fs.readFileSync(path.join(RAIZ, "next.config.mjs"), "utf8");
    const redirects = cfg.slice(cfg.indexOf("redirects()"), cfg.indexOf("headers()"));
    expect(redirects).not.toMatch(/google|source: "\/\(\.\*\)"/);
  });
});
