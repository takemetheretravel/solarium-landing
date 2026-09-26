import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
  pastasDoItem,
  destaque,
  buscarPorArquivo,
  montarGaleriaDaCasa,
  podeSerVitrine,
  type ItemGaleria,
} from ".";
import { PASTAS, numeroNoNome, ordenarPastas, PASTA_FORA } from "./pastas";
import { normalizarAmbiente } from "../../../scripts/galerias/nomes";

const RAIZ = path.resolve(__dirname, "../../..");
const CASAS = ["solarium-1", "solarium-2", "solarium-completo"];
const MESES = Array.from({ length: 12 }, (_, i) => i + 1);
const lerJson = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(RAIZ, rel), "utf8"));

function item(p: Partial<ItemGaleria>): ItemGaleria {
  return {
    arquivo: "x/a.jpg", largura: 10, altura: 10, alt: "alt", ambiente: "vista", pastas: ["vista"], estacao: "neutra",
    destaque: false, ordem: 1, tambemEm: [], baixaResolucao: false, excluirDoSite: false,
    creditoPendente: false, marcaDagua: false, telaComConteudo: false, ...p,
  };
}

describe("urlGaleria", () => {
  it("usa o projeto do ambiente e codifica cada segmento", () => {
    expect(urlGaleria("solarium-1/spa/a b.jpg")).toBe(
      "https://exemplo.supabase.co/storage/v1/object/public/galerias/solarium-1/spa/a%20b.jpg",
    );
  });
});

describe("ordenarPorEstacao", () => {
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
});

describe("IMG-1a-ajustes-2 — pastas definem os chips", () => {
  it("tabela de chips na ordem pedida", () => {
    expect(PASTAS.map((p) => p.rotulo)).toEqual([
      "Vista", "SPA", "Quarto", "Cinema", "Banheiro da suíte", "Banheiro social", "Banheiro",
      "Cozinha", "Área gourmet", "Sala", "Rede", "Amanhecer", "Área externa", "As duas casas", "Mais fotos",
    ]);
  });

  it.each([
    ["area gourmet", "area-gourmet"],
    ["banheiro_suíte", "banheiro-suite"],
    ["banheiro_social", "banheiro-social"],
    ["Banheiro", "banheiro"],
    [null, "geral"],
  ])("pasta do Drive %s → chip %s", (pasta, slug) => {
    const s = normalizarAmbiente(pasta);
    expect(s).toBe(slug);
    expect(PASTAS.some((p) => p.slug === s)).toBe(true);
  });

  it("número no começo do nome define a ordem", () => {
    expect(numeroNoNome("01 Banheira.jpg")).toBe(1);
    expect(numeroNoNome("02-banheira.jpg")).toBe(2);
    expect(numeroNoNome("Cópia de 3_banheira.jpg")).toBe(3);
    expect(numeroNoNome("Cópia de Solarium 1_Banheira.jpg")).toBeUndefined();
    expect(numeroNoNome("2024 Banheira.jpg")).toBe(2024);
  });

  it("'Todas' vem primeiro; depois um chip por pasta, na ordem da tabela", () => {
    const itens = [
      item({ arquivo: "a", pastas: ["rede", "vista"], ambiente: "vista" }),
      item({ arquivo: "b", pastas: ["banheiro-social"], ambiente: "banheiro-social" }),
      item({ arquivo: "c", pastas: ["spa"], ambiente: "spa" }),
    ];
    const cats = porAmbiente(itens);
    expect(cats.map((c) => c.id)).toEqual(["todas", "vista", "spa", "banheiro-social", "rede"]);
    expect(cats[0].itens.map((i) => i.arquivo)).toEqual(["a", "b", "c"]);
    expect(cats.find((c) => c.id === "rede")!.itens.map((i) => i.arquivo)).toEqual(["a"]);
  });

  it("dentro do chip, numeradas primeiro pelo número; as demais na ordem da galeria", () => {
    const itens = [
      item({ arquivo: "a", ordem: 1 }),
      item({ arquivo: "b", ordem: 2, ordemNaPasta: { vista: 2 } }),
      item({ arquivo: "c", ordem: 3, ordemNaPasta: { vista: 1 } }),
    ];
    expect(porAmbiente(itens).find((c) => c.id === "vista")!.itens.map((i) => i.arquivo)).toEqual(["c", "b", "a"]);
  });

  it.each(["solarium-1", "solarium-2"] as const)("%s: nenhum chip tem foto repetida", (g) => {
    for (const c of porAmbiente(carregarGaleria(g))) {
      const arq = c.itens.map((i) => i.arquivo);
      expect(new Set(arq).size, c.rotulo).toBe(arq.length);
    }
  });

  it.each(["solarium-1", "solarium-2", "completo"] as const)("%s: toda foto está no chip de cada pasta sua", (g) => {
    const cats = porAmbiente(carregarGaleria(g));
    for (const i of carregarGaleria(g)) {
      for (const p of pastasDoItem(i)) {
        expect(cats.find((c) => c.id === p)?.itens.some((x) => x.arquivo === i.arquivo), `${i.arquivo} em ${p}`).toBe(true);
      }
    }
  });

  it("casas: nada é excluído automaticamente", () => {
    for (const g of ["solarium-1", "solarium-2", "completo"]) {
      const m = lerJson<ItemGaleria[]>(`content/galerias/${g}.json`);
      expect(m.every((i) => !i.excluirDoSite), g).toBe(true);
      expect(carregarGaleria(g as "solarium-1").length).toBe(m.length);
    }
  });

  it("Solarium 1 → Banheiro social tem o chuveiro; Solarium 2 → Banheiro tem o vaso", () => {
    const chip = (g: "solarium-1" | "solarium-2", id: string) =>
      porAmbiente(carregarGaleria(g)).find((c) => c.id === id)!.itens.map((i) => i.arquivo);
    expect(chip("solarium-1", "banheiro-social")).toContain("solarium-1/banheiro-social/chuveiro-do-banheiro-social.jpg");
    expect(chip("solarium-2", "banheiro")).toContain("solarium-2/banheiro/lavabo-com-janela-estreita.jpg");
  });

  it("o arquivo de ajustes manuais saiu: as pastas substituem", () => {
    expect(fs.existsSync(path.join(RAIZ, "content/galerias/ajustes-manuais.json"))).toBe(false);
  });
});

describe("IMG-1a-ajustes-2 — quase-duplicatas", () => {
  const grupos = lerJson<{ descricao: string; shas: string[] }[]>("content/galerias/quase-duplicatas.json");
  const caminhos = lerJson<Record<string, string>>("content/galerias/caminhos.json");
  const noSite = new Set(
    ["solarium-1", "solarium-2", "completo", "experiencias", "comum"].flatMap((g) =>
      lerJson<ItemGaleria[]>(`content/galerias/${g}.json`).map((i) => i.arquivo),
    ),
  );

  it("nenhum grupo aparece com mais de um membro", () => {
    for (const g of grupos) {
      const presentes = g.shas.filter((s) => noSite.has(caminhos[s]));
      expect(presentes.length, g.descricao).toBeLessThanOrEqual(1);
    }
  });

  it("Solarium 2: o quarto e SPA ao pôr do sol aparece uma vez só (SPA, Vista e Mais fotos)", () => {
    const spa = porAmbiente(carregarGaleria("solarium-2")).find((c) => c.id === "spa")!.itens.map((i) => i.arquivo);
    expect(spa).toContain("solarium-2/vista/quarto-e-spa-ao-por-do-sol.jpg");
    expect(spa).not.toContain("solarium-2/spa/spa-de-imersao-ao-por-do-sol.jpg");
  });

  it("todo caminho no bucket é único", () => {
    const v = Object.values(caminhos);
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("capa e mosaico", () => {
  it("capa de cada casa pode ser vitrine", () => {
    for (const g of ["solarium-1", "solarium-2", "completo"] as const) {
      expect(podeSerVitrine(destaque(g)!), g).toBe(true);
    }
  });

  it.each(["solarium-1", "solarium-2"])("%s: mosaico com fotos de vista/spa que podem ser vitrine, sem a capa", (slug) => {
    const g = montarGaleriaDaCasa(slug);
    expect(g.mosaico).toHaveLength(5);
    for (const i of g.mosaico) {
      expect(podeSerVitrine(i), i.arquivo).toBe(true);
      expect(i.arquivo).not.toBe(g.hero.arquivo);
      expect(pastasDoItem(i).some((p) => p === "vista" || p === "spa"), i.arquivo).toBe(true);
    }
  });

  it("buscarPorArquivo acha em qualquer manifesto", () => {
    const capa = destaque("solarium-2")!;
    expect(buscarPorArquivo(capa.arquivo)).toEqual(capa);
    expect(buscarPorArquivo("nao/existe.jpg")).toBeUndefined();
  });

  it("crédito pendente só aparece com crédito", () => {
    expect(podeAparecer(item({ creditoPendente: true }))).toBe(false);
    expect(podeAparecer(item({ creditoPendente: true, credito: "Fulano" }))).toBe(true);
  });
});

describe.each(CASAS)("página de %s", (slug) => {
  it.each(MESES)("mês %i: hero e mosaico sem repetição; toda foto visível na grade", (mes) => {
    const g = montarGaleriaDaCasa(slug, mes);
    const topo = [g.hero, ...g.mosaico].map((i) => i.arquivo);
    expect(new Set(topo).size).toBe(topo.length);
    const naGrade = new Set(g.categorias.flatMap((c) => c.itens.map((i) => i.arquivo)));
    for (const i of g.todas) expect(naGrade.has(i.arquivo), i.arquivo).toBe(true);
  });

  it("'Todas' é o primeiro chip e não repete", () => {
    const g = montarGaleriaDaCasa(slug);
    expect(g.categorias[0].id).toBe("todas");
    const arq = g.categorias[0].itens.map((i) => i.arquivo);
    expect(new Set(arq).size).toBe(arq.length);
  });

  it("renderizado: hero e mosaico sem <img> repetida; todas com alt", () => {
    const g = montarGaleriaDaCasa(slug);
    const topo = renderToStaticMarkup(
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
    const origem = (t: string) => decodeURIComponent(/url=([^&"]+)/.exec(t)?.[1] ?? /src="([^"]+)"/.exec(t)![1]);
    const srcs = tags(topo).map(origem);
    expect(srcs.length).toBe(6);
    expect(new Set(srcs).size).toBe(6);
    for (const t of [...tags(topo), ...tags(grade)]) expect(/alt="([^"]+)"/.exec(t)?.[1]?.trim(), t).toBeTruthy();
  });
});

// As pastas não estão no git (repositório público): esta parte só roda na
// máquina que tem `galerias-local/` e rodou o preparo.
const LOCAL = path.join(RAIZ, "galerias-local");
const ORIGEM_JSON = path.join(RAIZ, "galerias-processadas", "_origem.json");
describe.skipIf(!fs.existsSync(LOCAL) || !fs.existsSync(ORIGEM_JSON))("IMG-1a-ajustes-2 — pastas locais × site", () => {
  type Origem = { arquivo: string; pastas: string[]; origens: { origem: string; pasta: string; sha: string }[] };
  const origens = lerJson<Origem[]>("galerias-processadas/_origem.json");
  const raizCasas = fs.existsSync(path.join(LOCAL, "casas")) ? LOCAL : path.join(LOCAL, fs.readdirSync(LOCAL).find((d) => fs.existsSync(path.join(LOCAL, d, "casas")))!);
  const listar = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          if (e.name === PASTA_FORA || e.name.startsWith(".")) return [];
          const p = path.join(dir, e.name);
          return e.isDirectory() ? listar(p) : /\.(jpe?g|png|heic|heif)$/i.test(e.name) ? [p] : [];
        })
      : [];
  const casas: [string, "solarium-1" | "solarium-2" | "completo"][] = [
    ["solarium-1", "solarium-1"],
    ["solarium-2", "solarium-2"],
    ["solarium-completo", "completo"],
  ];

  it.each(casas)("%s: toda foto das pastas (fora de _fora) aparece no chip da sua pasta", (pasta, g) => {
    const base = path.join(raizCasas, "casas", pasta);
    const cats = porAmbiente(carregarGaleria(g));
    const shaParaArquivo = new Map(origens.flatMap((o) => o.origens.map((x) => [x.sha, o.arquivo] as const)));
    const arquivos = listar(base);
    expect(arquivos.length).toBeGreaterThan(0);
    for (const abs of arquivos) {
      const dentro = path.relative(base, abs).split(path.sep);
      const chip = normalizarAmbiente(dentro.length > 1 ? dentro[0] : null);
      const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      const noSite = shaParaArquivo.get(sha);
      expect(noSite, path.relative(raizCasas, abs)).toBeDefined();
      expect(cats.find((c) => c.id === chip)?.itens.some((i) => i.arquivo === noSite), `${noSite} no chip ${chip}`).toBe(true);
    }
  }, 60_000);

  it.each(casas)("%s: nº de fotos por chip = nº de fotos distintas na pasta", (pasta, g) => {
    const base = path.join(raizCasas, "casas", pasta);
    const cats = porAmbiente(carregarGaleria(g));
    const shaParaArquivo = new Map(origens.flatMap((o) => o.origens.map((x) => [x.sha, o.arquivo] as const)));
    const porPasta = new Map<string, Set<string>>();
    for (const abs of listar(base)) {
      const dentro = path.relative(base, abs).split(path.sep);
      const chip = normalizarAmbiente(dentro.length > 1 ? dentro[0] : null);
      const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      porPasta.set(chip, (porPasta.get(chip) ?? new Set()).add(shaParaArquivo.get(sha)!));
    }
    for (const [chip, fotos] of Array.from(porPasta)) {
      expect(cats.find((c) => c.id === chip)!.itens.length, chip).toBe(fotos.size);
    }
    expect(ordenarPastas(Array.from(porPasta.keys()))).toEqual(cats.slice(1).map((c) => c.id));
  }, 60_000);
});

describe("lightbox sem corte e por cima de tudo", () => {
  const ler = (f: string) => fs.readFileSync(path.join(RAIZ, f), "utf8");

  it("foto inteira: proporção do manifesto, contain, sizes 100vw — nunca cover", () => {
    const i = destaque("solarium-1")!;
    const html = renderToStaticMarkup(createElement(ImagemInteira, { item: i, alturaMaxima: "80vh" }));
    expect(html).toContain(`width="${i.largura}"`);
    expect(html).toContain(`height="${i.altura}"`);
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
    const i = { ...destaque("solarium-1")!, foco: "esquerda" as const };
    expect(renderToStaticMarkup(createElement(ImagemGaleria, { item: i, sizes: "50vw" }))).toMatch(/object-position:left center/);
  });
});

describe("verificação do Search Console", () => {
  const ARQ = "google017462615c616c47.html";

  it("arquivo em public/ com o texto exato, sem quebra de linha", () => {
    expect(fs.readFileSync(path.join(RAIZ, "public", ARQ), "utf8")).toBe(`google-site-verification: ${ARQ}`);
  });

  it("nenhum middleware nem redirect intercepta a rota", () => {
    const mw = fs.readFileSync(path.join(RAIZ, "src/middleware.ts"), "utf8");
    expect(/matcher:\s*\[([^\]]*)\]/.exec(mw)![1]).not.toMatch(/google|\(\.\*\)|:path\*/);
    const cfg = fs.readFileSync(path.join(RAIZ, "next.config.mjs"), "utf8");
    expect(cfg.slice(cfg.indexOf("redirects()"), cfg.indexOf("headers()"))).not.toMatch(/google|source: "\/\(\.\*\)"/);
  });
});

describe("página de casa no código", () => {
  const fonte = fs.readFileSync(path.join(RAIZ, "src/app/(site)/[propertyId]/page.tsx"), "utf8");

  it("monta tudo a partir do manifesto (sem galleryImages/heroImage)", () => {
    expect(fonte).not.toMatch(/galleryImages|heroImage|SOLARIUM_COMPLETO_GALLERY_GROUPS/);
    expect(fonte).toMatch(/montarGaleriaDaCasa\(/);
  });

  it("nenhum componente de galeria monta URL de imagem na mão", () => {
    const dir = path.join(RAIZ, "src/components/galeria");
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/supabase\.co|storage\/v1/);
  });
});
