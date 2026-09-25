import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const RAIZ = path.resolve(__dirname, "../../..");

function arquivos(dir: string): string[] {
  return fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return arquivos(rel);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : [];
  });
}

describe("IMG-0 — credenciais e fotos fora do código do site", () => {
  it("SUPABASE_SERVICE_ROLE_KEY só aparece em scripts/", () => {
    const usam = arquivos("src").filter((rel) =>
      fs.readFileSync(path.join(RAIZ, rel), "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"),
    );
    expect(usam).toEqual([]);
  });

  it("@supabase/supabase-js não é importado pelo site", () => {
    const usam = arquivos("src").filter((rel) =>
      /from\s+["']@supabase\/supabase-js["']|import\(["']@supabase\/supabase-js["']\)/.test(
        fs.readFileSync(path.join(RAIZ, rel), "utf8"),
      ),
    );
    expect(usam).toEqual([]);
  });

  it("originais e processadas estão no .gitignore (repositório público)", () => {
    const gi = fs.readFileSync(path.join(RAIZ, ".gitignore"), "utf8");
    expect(gi).toMatch(/^\/galerias-local\/$/m);
    expect(gi).toMatch(/^\/galerias-processadas\/$/m);
  });
});
