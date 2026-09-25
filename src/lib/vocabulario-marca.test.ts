import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Vocabulário proibido pela marca (CLAUDE.md §5), em qualquer texto de
 * conteúdo ou metadado do site. Complementa o `scripts/lint-copy.mjs`, que
 * roda no build mas só olha a copy dos pacotes.
 *
 * Fica de fora, por serem citação ou resposta deliberada:
 * - depoimentos de hóspedes (`REVIEWS`, em src/config/site.ts);
 * - o item de FAQ "É uma cabana ou um chalé?", que existe para responder a
 *   quem chega pela busca com essas palavras.
 */

const RAIZ = path.resolve(__dirname, "../..");

const ESCOPO = ["src/app/(site)", "src/components", "src/config", "src/lib/seo.ts"];

/** Sem acento e em minúsculas. `\b` inicial evita falso positivo ("fluxo"). */
const PROIBIDOS: { termo: string; re: RegExp }[] = [
  { termo: "luxo", re: /\bluxo/ },
  { termo: "exclusiv", re: /\bexclusiv/ },
  { termo: "premium", re: /\bpremium/ },
  { termo: "sofisticad", re: /\bsofisticad/ },
  { termo: "sofisticação", re: /\bsofisticac/ },
  { termo: "investimento", re: /\binvestimento/ },
  { termo: "experiência única", re: /\bexperiencias?\s+unicas?\b/ },
  { termo: "momentos inesquecíveis", re: /\bmomentos\s+inesqueciveis\b/ },
  { termo: "lugar perfeito", re: /\blugar\s+perfeito\b/ },
  { termo: "chalé", re: /\bchales?\b/ },
  { termo: "pousada", re: /\bpousadas?\b/ },
  { termo: "amenidades", re: /\bamenidades\b/ },
];

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function arquivosDe(alvo: string): string[] {
  const abs = path.join(RAIZ, alvo);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(alvo, e.name);
    if (e.isDirectory()) return arquivosDe(rel);
    if (/\.test\.tsx?$/.test(e.name)) return [];
    return /\.(ts|tsx)$/.test(e.name) ? [path.join(RAIZ, rel)] : [];
  });
}

/** Mesmo recorte do lint-copy: literais de string e texto JSX. */
function textoVisivel(linha: string): string {
  const trechos: string[] = [];
  const literais = linha.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [];
  for (const l of literais) trechos.push(l.slice(1, -1).replace(/\$\{[^}]*\}/g, " "));
  const semLiterais = linha.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
  const jsx = semLiterais.match(/>([^<>{}]+)</g) ?? [];
  for (const j of jsx) trechos.push(j.slice(1, -1));
  return trechos.join(" ");
}

function ehComentario(linha: string): boolean {
  const t = linha.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("{/*");
}

/** Linhas (0-based) liberadas por serem citação ou a resposta deliberada do FAQ. */
function linhasLiberadas(arquivo: string, linhas: string[]): Set<number> {
  const livres = new Set<number>();
  const rel = path.relative(RAIZ, arquivo).replace(/\\/g, "/");

  if (rel === "src/config/site.ts") {
    const ini = linhas.findIndex((l) => l.startsWith("export const REVIEWS"));
    if (ini >= 0) {
      for (let i = ini; i < linhas.length; i++) {
        livres.add(i);
        if (linhas[i].startsWith("];")) break;
      }
    }
  }

  if (rel === "src/components/ui/FAQ.tsx") {
    const ini = linhas.findIndex((l) => l.includes('q: "É uma cabana ou um chalé?"'));
    if (ini >= 0) {
      for (let i = ini; i < linhas.length; i++) {
        livres.add(i);
        if (linhas[i].trim() === "},") break;
      }
    }
  }

  return livres;
}

function varrer() {
  const achados: string[] = [];
  for (const alvo of ESCOPO) {
    for (const arquivo of arquivosDe(alvo)) {
      const linhas = fs.readFileSync(arquivo, "utf8").split(/\r?\n/);
      const livres = linhasLiberadas(arquivo, linhas);
      linhas.forEach((linha, i) => {
        if (livres.has(i) || ehComentario(linha)) return;
        const plana = semAcento(textoVisivel(linha));
        if (!plana.trim()) return;
        for (const { termo, re } of PROIBIDOS) {
          if (re.test(plana)) {
            const rel = path.relative(RAIZ, arquivo).replace(/\\/g, "/");
            achados.push(`${rel}:${i + 1} "${termo}" — ${linha.trim().slice(0, 100)}`);
          }
        }
      });
    }
  }
  return achados;
}

describe("vocabulário da marca", () => {
  it("nenhum termo proibido em conteúdo ou metadado do site", () => {
    expect(varrer()).toEqual([]);
  });

  it("as exceções continuam existindo (senão a liberação ficou órfã)", () => {
    const faq = fs.readFileSync(path.join(RAIZ, "src/components/ui/FAQ.tsx"), "utf8");
    expect(faq).toContain('q: "É uma cabana ou um chalé?"');
    const site = fs.readFileSync(path.join(RAIZ, "src/config/site.ts"), "utf8");
    expect(site).toMatch(/^export const REVIEWS/m);
  });

  it("o detector pega o que deve pegar e ignora falso positivo", () => {
    const pega = (t: string) => PROIBIDOS.some(({ re }) => re.test(semAcento(t)));
    expect(pega("Duas casas exclusivas")).toBe(true);
    expect(pega("Conforto, luxo e qualidade")).toBe(true);
    expect(pega("Parceiro com sofisticação")).toBe(true);
    expect(pega("um chalé na serra")).toBe(true);
    expect(pega("Uma Experiência Única")).toBe(true);
    expect(pega("o fluxo avulso")).toBe(false);
    expect(pega("chaleira elétrica")).toBe(false);
  });
});
