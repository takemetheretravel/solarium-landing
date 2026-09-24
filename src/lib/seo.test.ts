import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  SEO_PAGINAS,
  SITE_URL,
  LIMITE_TITLE,
  LIMITE_DESCRIPTION,
  OG_IMAGENS,
  metadadosPagina,
  metadadosDe,
} from "./seo";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

describe("SEO local — titles e descriptions", () => {
  it.each(["/", "/solarium-1", "/solarium-2", "/solarium-completo"] as const)(
    "%s tem Itanhandu no title",
    (rota) => {
      expect(SEO_PAGINAS[rota].title).toContain("Itanhandu");
    },
  );

  it.each(Object.entries(SEO_PAGINAS))("%s respeita os limites de tamanho", (_rota, { title, description }) => {
    expect(title.length).toBeLessThanOrEqual(LIMITE_TITLE);
    expect(description.length).toBeLessThanOrEqual(LIMITE_DESCRIPTION);
  });

  it("title é absoluto — o template do layout não acrescenta sufixo", () => {
    const m = metadadosDe("/solarium-1");
    expect(m.title).toEqual({ absolute: SEO_PAGINAS["/solarium-1"].title });
  });
});

describe("SEO local — canonical e sociais", () => {
  it("canonical aponta para o www, com e sem caminho", () => {
    expect(SITE_URL).toBe("https://www.solariummantiqueira.com");
    expect(metadadosDe("/").alternates?.canonical).toBe(SITE_URL);
    expect(metadadosDe("/solarium-2").alternates?.canonical).toBe(`${SITE_URL}/solarium-2`);
  });

  it("og e twitter são da própria página, não herdados da home", () => {
    const m = metadadosDe("/solarium-completo", OG_IMAGENS["solarium-completo"]);
    const t = SEO_PAGINAS["/solarium-completo"];
    expect(m.openGraph?.title).toBe(t.title);
    expect(m.openGraph?.description).toBe(t.description);
    expect(m.twitter?.title).toBe(t.title);
    expect(m.twitter?.description).toBe(t.description);
    expect(m.twitter?.images).toEqual([OG_IMAGENS["solarium-completo"]]);
  });

  it("imagens de compartilhamento existem em public/", () => {
    for (const img of Object.values(OG_IMAGENS)) {
      expect(fs.existsSync(path.join(RAIZ, "public", img)), img).toBe(true);
    }
  });

  it("imagem que não é do /og/ não ganha dimensão inventada", () => {
    const m = metadadosPagina({ caminho: "/x", title: "t", description: "d", imagem: "https://exemplo/y.jpg" });
    const [img] = m.openGraph?.images as { width?: number }[];
    expect(img.width).toBeUndefined();
  });

  it("nenhuma página, layout ou config de SEO referencia drive.google.com", () => {
    const alvos = [
      "src/app/(site)/layout.tsx",
      "src/app/(site)/page.tsx",
      "src/app/(site)/[propertyId]/page.tsx",
      "src/app/sitemap.ts",
      "src/app/robots.ts",
      "src/lib/seo.ts",
    ];
    for (const rel of alvos) expect(ler(rel), rel).not.toContain("drive.google.com");
  });

  it("toda página indexável declara metadados pelo helper (canonical próprio)", () => {
    const paginas = [
      "src/app/(site)/page.tsx",
      "src/app/(site)/[propertyId]/page.tsx",
      "src/app/(site)/experiencias/page.tsx",
      "src/app/(site)/ofertas/page.tsx",
      "src/app/(site)/pacotes/page.tsx",
      "src/app/(site)/pacotes/[slug]/page.tsx",
      "src/app/(site)/parceiros/page.tsx",
      "src/app/(site)/privacidade/page.tsx",
      "src/app/(site)/termos/page.tsx",
    ];
    for (const rel of paginas) expect(ler(rel), rel).toMatch(/metadados(Pagina|De)\(/);
  });

  it("o layout não define canonical (espalharia a home para todas as páginas)", () => {
    expect(ler("src/app/(site)/layout.tsx")).not.toMatch(/canonical/);
  });
});

describe("SEO local — textos visíveis", () => {
  it("home cita Itanhandu no eyebrow e na seção Onde estamos", () => {
    const home = ler("src/app/(site)/page.tsx");
    expect(home).toContain("Itanhandu · Serra da Mantiqueira · MG");
    expect(home).toContain("Bairro Jardim, Itanhandu — Minas Gerais.");
    expect(home).not.toContain("A poucos quilômetros de Itanhandu");
  });
});
