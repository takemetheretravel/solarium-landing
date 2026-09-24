import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Todo `next/image` precisa de `sizes`. Sem ele o navegador escolhe a largura
 * pelo srcset inteiro e o celular acaba baixando a versão de 3840px.
 *
 * Allowlist: a página de pagamento não pode ser alterada sem instrução
 * explícita (CLAUDE.md, regra 2). Ela fica fora da varredura, registrado no
 * DECISOES.md (SEO-1a).
 */

const RAIZ = path.resolve(__dirname, "../..");

const ALLOWLIST = ["src/app/(checkout)/reservar/[draftId]/pagamento/page.tsx"];

function tsxDe(dir: string): string[] {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return tsxDe(rel);
    return e.name.endsWith(".tsx") ? [rel] : [];
  });
}

/** Nome local do componente importado de next/image (`Image`, `NextImage`…). */
function nomeImportado(fonte: string): string | null {
  const m = fonte.match(/import\s+(\w+)\s+from\s+["']next\/image["']/);
  return m ? m[1] : null;
}

/** Cada elemento `<Nome ... />` ou `<Nome ...>`, com os atributos. */
function elementos(fonte: string, nome: string): string[] {
  const achados: string[] = [];
  const re = new RegExp(`<${nome}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    let profundidade = 0;
    let i = m.index + 1;
    for (; i < fonte.length; i++) {
      const c = fonte[i];
      if (c === "{") profundidade++;
      else if (c === "}") profundidade--;
      else if (c === ">" && profundidade === 0) break;
    }
    achados.push(fonte.slice(m.index, i + 1));
  }
  return achados;
}

function arquivosComImage() {
  return tsxDe("src")
    .map((rel) => ({ rel, fonte: fs.readFileSync(path.join(RAIZ, rel), "utf8") }))
    .filter(({ fonte }) => nomeImportado(fonte) !== null);
}

describe("next/image sempre com sizes", () => {
  it("todo elemento de next/image fora da allowlist declara sizes", () => {
    const semSizes: string[] = [];
    for (const { rel, fonte } of arquivosComImage()) {
      if (ALLOWLIST.includes(rel)) continue;
      const nome = nomeImportado(fonte)!;
      for (const el of elementos(fonte, nome)) {
        if (!/\bsizes\s*=/.test(el)) semSizes.push(`${rel}: ${el.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
    expect(semSizes).toEqual([]);
  });

  it("a varredura encontra os componentes conhecidos", () => {
    const rels = arquivosComImage().map((a) => a.rel);
    expect(rels).toContain("src/components/ui/SmartImage.tsx");
    expect(rels).toContain("src/components/layout/Header.tsx");
  });

  it("a allowlist não fica órfã", () => {
    for (const rel of ALLOWLIST) {
      const fonte = fs.readFileSync(path.join(RAIZ, rel), "utf8");
      expect(nomeImportado(fonte), `${rel} não usa mais next/image — remova da allowlist`).not.toBeNull();
    }
  });

  it("o detector reconhece elemento sem sizes", () => {
    const fonte = `import Image from "next/image";\n<Image src={a} alt="x" width={1} height={1} />`;
    const [el] = elementos(fonte, "Image");
    expect(/\bsizes\s*=/.test(el)).toBe(false);
    const [comArrow] = elementos(`<Image onError={() => f(x > 1)} sizes="1px" />`, "Image");
    expect(comArrow).toContain('sizes="1px"');
  });
});
