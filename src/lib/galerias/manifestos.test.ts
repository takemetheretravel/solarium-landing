import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { GRUPOS, validarManifesto, itensVisiveis, podeSerVitrine, type Grupo, type ItemGaleria } from "./manifesto";
import { contemNomeDePessoa, NOMES_DE_PESSOAS } from "../../../scripts/galerias/nomes";

const RAIZ = path.resolve(__dirname, "../../..");
const DIR = path.join(RAIZ, "content/galerias");
const PROCESSADAS = path.join(RAIZ, "galerias-processadas");

const ler = (g: Grupo): ItemGaleria[] => JSON.parse(fs.readFileSync(path.join(DIR, `${g}.json`), "utf8"));
const MANIFESTOS = Object.fromEntries(GRUPOS.map((g) => [g, ler(g)])) as Record<Grupo, ItemGaleria[]>;
const TODOS = GRUPOS.flatMap((g) => MANIFESTOS[g]);
const CASAS: Grupo[] = ["solarium-1", "solarium-2", "completo"];

const palavras = (s: string) => s.trim().split(/\s+/).length;
const citaLugar = (s: string) => /Itanhandu|Serra da Mantiqueira/.test(s);
const ehBanheiro = (i: ItemGaleria) => i.ambiente.startsWith("banheiro");

describe("IMG-0 — schema dos manifestos", () => {
  it.each(GRUPOS)("%s é válido", (g) => {
    expect(validarManifesto(g, MANIFESTOS[g])).toEqual([]);
  });

  it.each(GRUPOS)("%s: ordem é 1..N sem buraco", (g) => {
    const ordens = MANIFESTOS[g].map((i) => i.ordem).sort((a, b) => a - b);
    expect(ordens).toEqual(ordens.map((_, i) => i + 1));
  });

  it("o validador recusa item quebrado", () => {
    const ruim = [{ ...MANIFESTOS["solarium-1"][0], estacao: "outono", extra: 1 }];
    expect(validarManifesto("solarium-1", ruim).length).toBeGreaterThan(0);
  });
});

describe("IMG-0 — nomes de arquivo", () => {
  it("sem nome de pessoa, acento, espaço ou maiúscula", () => {
    for (const { arquivo } of TODOS) {
      expect(contemNomeDePessoa(arquivo), arquivo).toBeNull();
      expect(arquivo, arquivo).toMatch(/^[a-z0-9/.-]+$/);
    }
  });

  it("nome é slug estável, sem prefixo numérico de ordem", () => {
    for (const { arquivo } of TODOS) expect(path.basename(arquivo), arquivo).not.toMatch(/^\d/);
  });

  it("nenhum 'amenities', 'gravida' ou prefixo do Drive sobreviveu", () => {
    for (const { arquivo } of TODOS) {
      expect(arquivo).not.toMatch(/amenities|gravida|copia-de|ret-|solarium-\d-|solarium-completo-/);
    }
  });

  it("a curadoria (versionada) não carrega nome de pessoa", () => {
    const texto = fs.readFileSync(path.join(DIR, "curadoria.json"), "utf8").toLowerCase();
    for (const n of NOMES_DE_PESSOAS) expect(texto).not.toMatch(new RegExp(`\\b${n}\\b`));
  });
});

describe("IMG-0 — curadoria", () => {
  it("alt entre 8 e 16 palavras, único em todo o acervo", () => {
    for (const { alt, arquivo } of TODOS) {
      expect(palavras(alt), arquivo).toBeGreaterThanOrEqual(8);
      expect(palavras(alt), arquivo).toBeLessThanOrEqual(16);
    }
    const alts = TODOS.map((i) => i.alt);
    expect(new Set(alts).size).toBe(alts.length);
  });

  it.each(GRUPOS)("%s: Itanhandu/Serra da Mantiqueira em no máximo 1 a cada 4 alts", (g) => {
    const itens = MANIFESTOS[g];
    expect(itens.filter((i) => citaLugar(i.alt)).length).toBeLessThanOrEqual(Math.floor(itens.length / 4) || 1);
  });

  it.each(CASAS)("%s: exatamente 1 destaque, que não é baixa resolução nem excluída", (g) => {
    const d = MANIFESTOS[g].filter((i) => i.destaque);
    expect(d).toHaveLength(1);
    expect(d[0].baixaResolucao).toBe(false);
    expect(d[0].excluirDoSite).toBe(false);
  });

  // Limite subiu de 3 para 6 na IMG-1a-ajustes. Inclusões manuais
  // (ajustes-manuais.json) não estão no manifesto e não contam.
  it.each(CASAS)("%s: no máximo 6 banheiros visíveis, sempre no fim", (g) => {
    const vis = itensVisiveis(MANIFESTOS[g]);
    const banheiros = vis.filter(ehBanheiro);
    expect(banheiros.length).toBeLessThanOrEqual(6);
    const primeiroBanheiro = vis.findIndex(ehBanheiro);
    if (primeiroBanheiro >= 0) expect(vis.slice(primeiroBanheiro).every(ehBanheiro)).toBe(true);
  });

  it.each(CASAS)("%s: capa é a primeira da ordem", (g) => {
    expect(itensVisiveis(MANIFESTOS[g])[0].destaque).toBe(true);
  });

  it("excluídas ficam depois de todas as visíveis", () => {
    for (const g of GRUPOS) {
      const itens = [...MANIFESTOS[g]].sort((a, b) => a.ordem - b.ordem);
      const i = itens.findIndex((x) => x.excluirDoSite);
      if (i >= 0) expect(itens.slice(i).every((x) => x.excluirDoSite), g).toBe(true);
    }
  });

  it.each(CASAS)("%s: capa sem marca d'água nem tela com conteúdo", (g) => {
    const capa = MANIFESTOS[g].find((i) => i.destaque)!;
    expect(podeSerVitrine(capa)).toBe(true);
  });

  it("o validador recusa capa com marca d'água ou tela", () => {
    const base = MANIFESTOS["solarium-1"].find((i) => i.destaque)!;
    expect(validarManifesto("solarium-1", [{ ...base, marcaDagua: true }]).join()).toMatch(/destaque/);
    expect(validarManifesto("solarium-1", [{ ...base, telaComConteudo: true }]).join()).toMatch(/destaque/);
  });

  it.each(GRUPOS)("%s: tela com conteúdo sempre no fim do próprio ambiente", (g) => {
    const vis = itensVisiveis(MANIFESTOS[g]);
    for (const amb of Array.from(new Set(vis.map((i) => i.ambiente)))) {
      const doAmbiente = vis.filter((i) => i.ambiente === amb);
      const primeira = doAmbiente.findIndex((i) => i.telaComConteudo);
      if (primeira >= 0) expect(doAmbiente.slice(primeira).every((i) => i.telaComConteudo), `${g}/${amb}`).toBe(true);
    }
  });

  it("marcações da curadoria: 28 com marca d'água, 8 com tela", () => {
    expect(TODOS.filter((i) => i.marcaDagua)).toHaveLength(28);
    expect(TODOS.filter((i) => i.telaComConteudo)).toHaveLength(8);
  });

  it("experiências: todas com crédito pendente; casas, nenhuma", () => {
    expect(MANIFESTOS.experiencias.every((i) => i.creditoPendente)).toBe(true);
    for (const g of CASAS) expect(MANIFESTOS[g].some((i) => i.creditoPendente)).toBe(false);
  });

  it("logos em PNG; fotos em JPG", () => {
    expect(MANIFESTOS.comum.every((i) => i.arquivo.startsWith("comum/marca/") && i.arquivo.endsWith(".png"))).toBe(true);
    for (const g of GRUPOS.filter((x) => x !== "comum")) {
      expect(MANIFESTOS[g].every((i) => i.arquivo.endsWith(".jpg"))).toBe(true);
    }
  });
});

// Os arquivos processados não vão para o git (repositório público): esta parte
// só roda na máquina onde `npm run galerias:preparar` foi executado.
describe.skipIf(!fs.existsSync(PROCESSADAS))("IMG-0 — arquivos processados", () => {
  it("todo item do manifesto existe, com as dimensões declaradas", async () => {
    for (const it of TODOS) {
      const meta = await sharp(path.join(PROCESSADAS, it.arquivo)).metadata();
      expect([meta.width, meta.height], it.arquivo).toEqual([it.largura, it.altura]);
    }
  }, 120_000);

  it("nenhum arquivo tem EXIF, GPS, XMP, IPTC ou orientação; tudo em sRGB", async () => {
    for (const it of TODOS) {
      const meta = await sharp(path.join(PROCESSADAS, it.arquivo)).metadata();
      expect(meta.exif, it.arquivo).toBeUndefined();
      expect(meta.xmp, it.arquivo).toBeUndefined();
      expect(meta.iptc, it.arquivo).toBeUndefined();
      expect(meta.icc, it.arquivo).toBeUndefined();
      expect(meta.orientation, it.arquivo).toBeUndefined();
      expect(meta.space, it.arquivo).toBe("srgb");
    }
  }, 120_000);

  it("lado maior: fotos até 2400px, logos até 1200px", () => {
    for (const it of TODOS) {
      const limite = it.arquivo.endsWith(".png") ? 1200 : 2400;
      expect(Math.max(it.largura, it.altura), it.arquivo).toBeLessThanOrEqual(limite);
    }
  });

  it("não há arquivo solto fora dos manifestos (menos gmb/ e pastas de trabalho)", () => {
    const listar = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        return e.isDirectory() ? listar(p) : [path.relative(PROCESSADAS, p).replace(/\\/g, "/")];
      });
    const noDisco = listar(PROCESSADAS).filter((r) => !/^(gmb|\.cache|_revisao)\/|^(_origem\.json|folha-contato\.html)$/.test(r));
    expect(noDisco.sort()).toEqual(TODOS.map((i) => i.arquivo).sort());
  });

  it("gmb/ não tem foto com marca d'água, tela com conteúdo, baixa resolução ou excluída", () => {
    const porNome = new Map(TODOS.map((i) => [`${i.arquivo.split("/")[0]}-${path.basename(i.arquivo)}`, i]));
    for (const a of fs.readdirSync(path.join(PROCESSADAS, "gmb"))) {
      const item = porNome.get(a.replace(/^\d{2}-/, ""));
      expect(item, a).toBeDefined();
      expect(podeSerVitrine(item!), a).toBe(true);
    }
  });

  it("gmb/ tem 25 fotos 4:3 com lado maior 1600px e sem metadados", async () => {
    const dir = path.join(PROCESSADAS, "gmb");
    const arquivos = fs.readdirSync(dir);
    expect(arquivos).toHaveLength(25);
    for (const a of arquivos) {
      const meta = await sharp(path.join(dir, a)).metadata();
      expect([meta.width, meta.height], a).toEqual([1600, 1200]);
      expect(meta.exif, a).toBeUndefined();
      expect(contemNomeDePessoa(a), a).toBeNull();
    }
  });
});
