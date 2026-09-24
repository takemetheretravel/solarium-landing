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
  type JsonLdObjeto,
} from "./json-ld";
import { SITE_URL } from "./seo";

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
  ...PROPERTIES.map((p) => [`casa ${p.slug}`, jsonLdCasa(p, 1)] as [string, JsonLdObjeto]),
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
    expect(home.containsPlace.map((c: any) => c.url)).toEqual(
      PROPERTIES.map((p) => `${SITE_URL}/${p.slug}`),
    );
  });
});

describe("JSON-LD — casas", () => {
  it.each(PROPERTIES)("$slug: VacationRental ligado ao negócio, em Itanhandu", (casa) => {
    const [obj] = renderizarEParsear(jsonLdCasa(casa, 2));
    expect(obj["@type"]).toBe("VacationRental");
    expect(obj["@id"]).toBe(idCasa(casa.slug));
    expect(obj.address.addressLocality).toBe("Itanhandu");
    expect(obj.containedInPlace).toEqual({ "@id": ID_NEGOCIO });
    expect(obj.image.length).toBeGreaterThanOrEqual(5);
    expect(new Set(obj.image).size).toBe(obj.image.length);
    for (const img of obj.image) expect(img).toMatch(/^https:\/\//);
    expect(obj.containsPlace["@type"]).toBe("Accommodation");
    expect(obj.containsPlace.occupancy.maxValue).toBe(casa.capacity.max);
    expect(obj.containsPlace.numberOfBedrooms).toBe(2);
    expect(obj.containsPlace.amenityFeature.length).toBeGreaterThan(0);
  });

  it("ocupação máxima é 4 nas casas e 8 no Completo", () => {
    const max = Object.fromEntries(
      PROPERTIES.map((p) => [p.slug, (jsonLdCasa(p) as any).containsPlace.occupancy.maxValue]),
    );
    expect(max).toEqual({ "solarium-1": 4, "solarium-2": 4, "solarium-completo": 8 });
  });

  it("sem número de quartos do Hostaway, o campo é omitido — nunca inventado", () => {
    for (const q of [undefined, null, 0]) {
      const obj = jsonLdCasa(PROPERTIES[0], q) as any;
      expect(obj.containsPlace).not.toHaveProperty("numberOfBedrooms");
    }
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
