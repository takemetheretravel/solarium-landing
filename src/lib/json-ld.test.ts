import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JsonLd from "@/components/seo/JsonLd";
import { PROPERTIES } from "@/config/properties";
import {
  jsonLdNegocio,
  jsonLdCasa,
  jsonLdBreadcrumb,
  MIGALHA_INICIO,
  MIGALHA_PACOTES,
  ID_NEGOCIO,
  idCasa,
  MIN_IMAGENS_CASA,
  ESTRUTURA,
  type JsonLdObjeto,
} from "./json-ld";
import { SITE_URL } from "./seo";
import { montarGaleriaDaCasa, podeSerVitrine, urlGaleria } from "./galerias";

const RAIZ = path.resolve(__dirname, "../..");

/** Renderiza como a página renderiza e devolve o JSON de cada <script>. */
function renderizarEParsear(dados: JsonLdObjeto): Record<string, any>[] {
  const html = renderToStaticMarkup(createElement(JsonLd, { dados }));
  const scripts = Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g));
  expect(scripts.length).toBe(1);
  return scripts.map(([, corpo]) => JSON.parse(corpo));
}

const TODOS: [string, JsonLdObjeto][] = [
  ["home", jsonLdNegocio()],
  ...PROPERTIES.map((p) => [`casa ${p.slug}`, jsonLdCasa(p)] as [string, JsonLdObjeto]),
  ["breadcrumb casa", jsonLdBreadcrumb([MIGALHA_INICIO, { nome: "Solarium 1", caminho: "/solarium-1" }])],
  ["breadcrumb pacotes", jsonLdBreadcrumb([MIGALHA_INICIO, MIGALHA_PACOTES])],
];

/** Toda chave de avaliação em qualquer nível. */
function temAvaliacao(o: unknown): boolean {
  if (Array.isArray(o)) return o.some(temAvaliacao);
  if (o && typeof o === "object") {
    return Object.entries(o).some(
      ([k, v]) => ["aggregateRating", "review", "reviews"].includes(k) || temAvaliacao(v),
    );
  }
  return false;
}

describe("JSON-LD — renderizado é JSON válido", () => {
  it.each(TODOS)("%s parseia, tem @context e @type", (_nome, dados) => {
    const [obj] = renderizarEParsear(dados);
    expect(obj["@context"]).toBe("https://schema.org");
    expect(typeof obj["@type"]).toBe("string");
  });

  it.each(TODOS)("%s não traz aggregateRating nem review", (_nome, dados) => {
    expect(temAvaliacao(dados)).toBe(false);
  });

  it("`<` no conteúdo não fecha a tag script", () => {
    const html = renderToStaticMarkup(
      createElement(JsonLd, { dados: { "@context": "https://schema.org", "@type": "Thing", name: "</script><b>" } }),
    );
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const corpo = html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(JSON.parse(corpo).name).toBe("</script><b>");
  });
});

describe("JSON-LD — negócio (home)", () => {
  const [home] = renderizarEParsear(jsonLdNegocio());

  it("LodgingBusiness em Itanhandu com os dados fixados na rodada", () => {
    expect(home["@type"]).toBe("LodgingBusiness");
    expect(home["@id"]).toBe(ID_NEGOCIO);
    expect(home.name).toBe("Solarium Mantiqueira");
    expect(home.url).toBe(SITE_URL);
    expect(home.telephone).toBe("+55 35 98407-5652");
    expect(home.priceRange).toBe("R$ 1.150+");
    expect(home.petsAllowed).toBe(true);
    expect(home.address).toMatchObject({
      addressLocality: "Itanhandu",
      addressRegion: "MG",
      postalCode: "37464-000",
      addressCountry: "BR",
      streetAddress: "Bairro Jardim",
    });
  });

  it("coordenadas com no máximo 2 casas decimais", () => {
    expect(home.geo).toEqual({ "@type": "GeoCoordinates", latitude: -22.29, longitude: -44.94 });
  });

  it("3 imagens absolutas", () => {
    expect(home.image).toHaveLength(3);
    for (const img of home.image) expect(img).toMatch(/^https:\/\//);
  });

  it("comodidades, sameAs e as três casas", () => {
    expect(home.amenityFeature.map((a: any) => a.name)).toEqual([
      "SPA aquecido",
      "Piso aquecido",
      "Cinema privativo",
      "Wi-Fi",
    ]);
    expect(home.sameAs).toContain("https://www.instagram.com/solariummantiqueira");
    expect(home.sameAs.filter((u: string) => u.includes("airbnb"))).toHaveLength(3);
    // Só referências por @id (sem @type/name): o Google não lê VacationRental
    // incompleto na home (IMG-1a-ajustes).
    expect(home.containsPlace).toEqual(PROPERTIES.map((p) => ({ "@id": idCasa(p.slug) })));
  });
});

describe("JSON-LD — casas", () => {
  const IDS_HOSTAWAY = { "solarium-1": "316007", "solarium-2": "316005", "solarium-completo": "316006" };

  it.each(PROPERTIES)("$slug: VacationRental completo para o Google", (casa) => {
    const [obj] = renderizarEParsear(jsonLdCasa(casa));
    expect(obj["@type"]).toBe("VacationRental");
    expect(obj["@id"]).toBe(idCasa(casa.slug));
    expect(obj.additionalType).toBe("House");
    expect(obj.identifier).toBe(IDS_HOSTAWAY[casa.slug]);
    expect(obj.description.length).toBeGreaterThan(20);
    expect(obj.address.addressLocality).toBe("Itanhandu");
    expect(obj.geo).toEqual({ "@type": "GeoCoordinates", latitude: -22.29, longitude: -44.94 });
    expect([obj.latitude, obj.longitude]).toEqual([-22.29, -44.94]);
    expect(obj.containedInPlace).toEqual({ "@id": ID_NEGOCIO });
    expect(obj.image.length).toBeGreaterThanOrEqual(MIN_IMAGENS_CASA);
    expect(new Set(obj.image).size).toBe(obj.image.length);
    for (const img of obj.image) expect(img).toMatch(/^https:\/\/.+\/storage\/v1\/object\/public\/galerias\//);
    const acc = obj.containsPlace;
    expect(acc["@type"]).toBe("Accommodation");
    expect(acc.additionalType).toBe("EntirePlace");
    expect(acc.occupancy).toEqual({ "@type": "QuantitativeValue", value: casa.capacity.max });
    expect(acc.numberOfBedrooms).toBeGreaterThan(0);
    expect(acc.numberOfBathroomsTotal).toBeGreaterThan(0);
    expect(acc.bed.length).toBeGreaterThan(0);
    for (const b of acc.bed) {
      expect(b["@type"]).toBe("BedDetails");
      expect(b.numberOfBeds).toBeGreaterThan(0);
      expect(b.typeOfBed).toBeTruthy();
    }
    expect(acc.amenityFeature.length).toBeGreaterThan(0);
  });

  it("imagens: capa primeiro, vitrines antes das demais, nenhuma excluída", () => {
    for (const casa of PROPERTIES) {
      const { hero, todas } = montarGaleriaDaCasa(casa.slug);
      const imgs = (jsonLdCasa(casa) as any).image as string[];
      expect(imgs[0]).toBe(urlGaleria(hero.arquivo));
      const visiveis = new Set(todas.map((i) => urlGaleria(i.arquivo)));
      for (const u of imgs) expect(visiveis.has(u) || u === urlGaleria(hero.arquivo), u).toBe(true);
      const ehVitrine = imgs.map((u) => podeSerVitrine(todas.find((i) => urlGaleria(i.arquivo) === u) ?? hero));
      const primeiraNao = ehVitrine.indexOf(false);
      if (primeiraNao >= 0) expect(ehVitrine.slice(primeiraNao).every((v) => !v)).toBe(true);
    }
  });

  it("ocupação: 4 nas casas e 8 no Completo; Completo soma quartos, banheiros e camas", () => {
    const acc = (slug: string) => (jsonLdCasa(PROPERTIES.find((p) => p.slug === slug)!) as any).containsPlace;
    expect([acc("solarium-1"), acc("solarium-2"), acc("solarium-completo")].map((a) => a.occupancy.value)).toEqual([4, 4, 8]);
    for (const campo of ["numberOfBedrooms", "numberOfBathroomsTotal"]) {
      expect(acc("solarium-completo")[campo]).toBe(acc("solarium-1")[campo] + acc("solarium-2")[campo]);
    }
    const camas = (a: any) => a.bed.reduce((n: number, b: any) => n + b.numberOfBeds, 0);
    expect(camas(acc("solarium-completo"))).toBe(camas(acc("solarium-1")) + camas(acc("solarium-2")));
  });

  it("a estrutura de cada casa está declarada", () => {
    for (const p of PROPERTIES) expect(ESTRUTURA[p.slug], p.slug).toBeDefined();
  });
});

describe("JSON-LD — breadcrumb", () => {
  it("posições em ordem e URLs absolutas", () => {
    const [obj] = renderizarEParsear(
      jsonLdBreadcrumb([MIGALHA_INICIO, MIGALHA_PACOTES, { nome: "Data especial", caminho: "/pacotes/data-especial" }]),
    );
    expect(obj.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Início", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Pacotes", item: `${SITE_URL}/pacotes` },
      { "@type": "ListItem", position: 3, name: "Data especial", item: `${SITE_URL}/pacotes/data-especial` },
    ]);
  });
});

describe("JSON-LD — origem única", () => {
  it("só o componente JsonLd emite application/ld+json", () => {
    const varrer = (dir: string): string[] =>
      fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return varrer(rel);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
      });
    const emissores = varrer("src").filter((rel) =>
      fs.readFileSync(path.join(RAIZ, rel), "utf8").includes("application/ld+json"),
    );
    expect(emissores).toEqual(["src/components/seo/JsonLd.tsx"]);
  });

  it("home, casas e pacotes usam o componente", () => {
    const paginas: [string, RegExp][] = [
      ["src/app/(site)/page.tsx", /jsonLdNegocio\(/],
      ["src/app/(site)/[propertyId]/page.tsx", /jsonLdCasa\([\s\S]*jsonLdBreadcrumb\(/],
      ["src/app/(site)/pacotes/page.tsx", /jsonLdBreadcrumb\(/],
      ["src/app/(site)/pacotes/[slug]/page.tsx", /jsonLdBreadcrumb\(/],
    ];
    for (const [rel, re] of paginas) {
      expect(fs.readFileSync(path.join(RAIZ, rel), "utf8"), rel).toMatch(re);
    }
  });
});
