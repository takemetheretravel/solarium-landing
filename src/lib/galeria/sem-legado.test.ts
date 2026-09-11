import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava a migração para o Cloudinary.
 *
 * Varre o CÓDIGO-FONTE, não o `.next/`: o bundle só existe depois do build, e
 * um teste que depende de build roda tarde demais para impedir o commit. Tudo
 * que é varrido aqui — `src/` e `content/` — atravessa para o bundle quando é
 * referenciado, então um `grep` limpo na origem é um bundle limpo.
 *
 * O que cada padrão impede de voltar:
 *  - `/images/solarium-`: JPG de casa servido de `/public`, sem transformação,
 *    baixado em tamanho original em qualquer viewport.
 *  - `drive.google.com`: Drive como CDN de imagem. Respondia com redirect que
 *    boa parte dos crawlers de rede social não segue, e o link compartilhado
 *    saía sem miniatura.
 */

const RAIZ = resolve(__dirname, "..", "..", "..");
const VARRER = ["src", "content"];
const EXTENSOES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];

const PROIBIDOS = [
  { padrao: "/images/solarium-", motivo: "JPG de casa em /public — use o publicId do Cloudinary" },
  { padrao: "drive.google.com", motivo: "Google Drive como CDN de imagem" },
];

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "node_modules" || nome === ".next") continue;
      achados.push(...arquivosDeCodigo(caminho));
      continue;
    }
    if (EXTENSOES.some((e) => nome.endsWith(e))) achados.push(caminho);
  }
  return achados;
}

const ARQUIVOS = VARRER.map((d) => resolve(RAIZ, d))
  .filter((d) => existsSync(d))
  .flatMap(arquivosDeCodigo)
  // Arquivos de teste ficam de fora: nenhum deles entra no bundle, e vários
  // precisam citar justamente os padrões proibidos para poder afirmar que a
  // aplicação não os usa. Incluí-los faria o detector acusar a si mesmo.
  .filter((f) => !/\.test\.tsx?$/.test(f));

describe("nenhuma referência legada de imagem sobrevive", () => {
  it("varreu de fato os diretórios de código", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(50);
  });

  it.each(PROIBIDOS)("não resta nenhum '$padrao' ($motivo)", ({ padrao }) => {
    const culpados: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const conteudo = readFileSync(arquivo, "utf8");
      if (!conteudo.includes(padrao)) continue;
      const linha = conteudo.split("\n").findIndex((l) => l.includes(padrao)) + 1;
      culpados.push(`${relative(RAIZ, arquivo).split(sep).join("/")}:${linha}`);
    }
    expect(culpados).toEqual([]);
  });
});

describe("os JPGs das casas saíram de /public", () => {
  it.each(["solarium-1", "solarium-2", "solarium-completo"])(
    "public/images/%s não existe mais",
    (pasta) => {
      expect(existsSync(resolve(RAIZ, "public", "images", pasta))).toBe(false);
    },
  );

  it("public/images/comum guarda só os logos", () => {
    const comum = resolve(RAIZ, "public", "images", "comum");
    expect(existsSync(comum)).toBe(true);
    for (const arquivo of readdirSync(comum)) {
      expect(arquivo).toMatch(/^logo-/);
    }
  });
});
