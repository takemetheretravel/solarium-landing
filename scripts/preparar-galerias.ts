#!/usr/bin/env tsx
/**
 * Prepara as fotos de `galerias-local/` para o Supabase Storage.
 *
 *   npm run galerias:preparar            processa, gera manifestos, relatório e gmb/
 *   npm run galerias:preparar -- --folhas  também gera folhas de contato para revisão
 *   npm run galerias:atualizar           preparo + upload do que é novo + folha + testes
 *
 * **As pastas do Lucas são a fonte da verdade** (IMG-1a-ajustes-2): toda foto
 * que está numa pasta aparece no site, no chip daquela pasta. A mesma foto em
 * várias pastas aparece em cada chip. Tirar do site = tirar da pasta (ou
 * mover para uma pasta `_fora`, ignorada). Número no começo do nome ("01 ")
 * define a ordem dentro da pasta.
 *
 * A curadoria (`content/galerias/curadoria.json`, por SHA-256 do original)
 * vale para alt, estação, descrição, ordem geral, capa, seleção do Google,
 * `marcaDagua` e `telaComConteudo` — não decide mais o que aparece nem onde.
 *
 * Arquivos gerados e versionados:
 * - `caminhos.json`: SHA → caminho no bucket, **congelado** na primeira vez.
 *   Mover a foto de pasta não muda o caminho; o ambiente vive no manifesto.
 * - manifestos `content/galerias/{grupo}.json` e `RELATORIO_IMAGENS.md`.
 *
 * Quase-duplicatas (mesma cena em recorte ou edição diferente) viram uma foto
 * só, que herda as pastas do grupo: os grupos confirmados em
 * `quase-duplicatas.json` e os detectados por pHash (reexportações).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { normalizarAmbiente, descricaoDoNomeOriginal, nomeFinal } from "./galerias/nomes";
import { podeSerVitrine, type Estacao, type Grupo, type ItemGaleria } from "../src/lib/galerias/manifesto";
import { ordenarPastas, numeroNoNome, rotuloDaPasta, PASTA_FORA } from "../src/lib/galerias/pastas";

const RAIZ = path.resolve(__dirname, "..");
const SAIDA = path.join(RAIZ, "galerias-processadas");
const CACHE = path.join(SAIDA, ".cache");
const REVISAO = path.join(SAIDA, "_revisao");
const GMB = path.join(SAIDA, "gmb");
const DIR_MANIFESTOS = path.join(RAIZ, "content", "galerias");
const ARQ_CURADORIA = path.join(DIR_MANIFESTOS, "curadoria.json");
const ARQ_CAMINHOS = path.join(DIR_MANIFESTOS, "caminhos.json");
const ARQ_QUASE = path.join(DIR_MANIFESTOS, "quase-duplicatas.json");
const ARQ_RELATORIO = path.join(RAIZ, "RELATORIO_IMAGENS.md");

const LADO_MAIOR = 2400;
const LADO_MAIOR_LOGO = 1200;
const LIMITE_BAIXA_RESOLUCAO = 1600;
const QUALIDADE = 82;
const GMB_LADO = 1600;
/** pHash: distância de Hamming até aqui = mesma imagem reexportada/reeditada. */
const PHASH_LIMITE = 6;
/** Resoluções a até 10% da maior contam como "a mesma" para preferir a retocada. */
const TOLERANCIA_RESOLUCAO = 0.9;

const EXT_IMAGEM = /\.(jpe?g|png|heic|heif)$/i;
const GRUPOS_ORDEM: Grupo[] = ["solarium-1", "solarium-2", "completo", "experiencias", "comum"];

// ---------------------------------------------------------------------------
// Tipos

type Curadoria = {
  descricao?: string;
  alt?: string;
  estacao?: Estacao;
  ordem?: number;
  destaque?: boolean;
  gmb?: boolean;
  gmbCapa?: boolean;
  marcaDagua?: boolean;
  telaComConteudo?: boolean;
};

/** Um arquivo em `galerias-local/`. */
type Fonte = {
  grupo: Grupo;
  pasta: string;
  /** Caminho relativo à raiz de origem. Só local, nunca vai para o git. */
  origem: string;
  sha: string;
  ext: string;
  numero?: number;
};

/** Uma imagem distinta (SHA) com todas as cópias dela nas pastas. */
type Unidade = {
  grupo: Grupo;
  sha: string;
  fontes: Fonte[];
  largura: number;
  altura: number;
  retocada: boolean;
  /** pHash como 64 caracteres '0'/'1'. */
  phash: string;
  /** Original em disco: relido só se o cache não tiver a conversão. */
  abs: string;
  ext: string;
};

/** A foto que vai para o site: vencedora de um grupo de quase-duplicatas. */
type Foto = {
  grupo: Grupo;
  sha: string;
  fica: Unidade;
  membros: Unidade[];
  pastas: string[];
  ordemNaPasta: Record<string, number>;
  cur: Curadoria;
  ehLogo: boolean;
  convertido: "heic" | "png" | null;
  arquivo: string;
  novo: boolean;
  ordem: number;
  largura: number;
  altura: number;
  autoGrupo: boolean;
};

// ---------------------------------------------------------------------------
// Origem

function raizOrigem(): string {
  const base = path.resolve(RAIZ, process.env.GALERIAS_LOCAL_DIR || "galerias-local");
  if (!fs.existsSync(base)) throw new Error(`Origem não encontrada: ${base}`);
  if (fs.existsSync(path.join(base, "casas"))) return base;
  const sub = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, "casas")));
  if (sub.length === 1) return path.join(base, sub[0].name);
  throw new Error(`Não achei a pasta "casas" em ${base}`);
}

/** Pastas de origem → grupo. O resto (pacotes, social, vídeo…) é ignorado. */
const MAPA: { pasta: string; grupo: Grupo; pastaFixa?: string }[] = [
  { pasta: "casas/solarium-1", grupo: "solarium-1" },
  { pasta: "casas/solarium-2", grupo: "solarium-2" },
  { pasta: "casas/solarium-completo", grupo: "completo" },
  { pasta: "experiencias", grupo: "experiencias", pastaFixa: "experiencias" },
  { pasta: "marca", grupo: "comum", pastaFixa: "marca" },
];

function listar(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === PASTA_FORA || e.name.startsWith(".")) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [p];
  });
}

const ignorados: string[] = [];

/** Pasta do arquivo em relação à casa: a primeira subpasta; solto na raiz = "geral". */
function lerFontes(origem: string): Fonte[] {
  const fontes: Fonte[] = [];
  for (const { pasta, grupo, pastaFixa } of MAPA) {
    const base = path.join(origem, pasta);
    for (const abs of listar(base)) {
      const rel = path.relative(origem, abs).replace(/\\/g, "/");
      if (!EXT_IMAGEM.test(abs)) {
        ignorados.push(rel);
        continue;
      }
      const dentro = path.relative(base, abs).split(path.sep);
      const buf = fs.readFileSync(abs);
      fontes.push({
        grupo,
        pasta: pastaFixa ?? normalizarAmbiente(dentro.length > 1 ? dentro[0] : null),
        origem: rel,
        sha: crypto.createHash("sha256").update(buf).digest("hex"),
        ext: path.extname(abs).slice(1).toLowerCase(),
        numero: numeroNoNome(path.basename(abs)),
      });
    }
  }
  return fontes;
}

// ---------------------------------------------------------------------------
// Imagem

async function decodificar(abs: string, ext: string): Promise<Buffer> {
  const buf = fs.readFileSync(abs);
  if (ext === "heic" || ext === "heif") {
    const jpg = await heicConvert({ buffer: buf, format: "JPEG", quality: 1 });
    return Buffer.from(jpg);
  }
  return buf;
}

/** pHash clássico: DCT 32×32 em cinza, 8×8 de baixa frequência, bit = acima da mediana. */
async function phash(buf: Buffer): Promise<string> {
  const N = 32;
  const { data } = await sharp(buf).rotate().greyscale().resize(N, N, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const cos = (i: number, u: number) => Math.cos(((2 * i + 1) * u * Math.PI) / (2 * N));
  const coef: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) s += data[y * N + x] * cos(x, u) * cos(y, v);
      coef.push(s);
    }
  }
  const semDC = coef.slice(1);
  const mediana = [...semDC].sort((a, b) => a - b)[Math.floor(semDC.length / 2)];
  return coef.map((c, i) => (i > 0 && c > mediana ? "1" : "0")).join("");
}

function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Converte uma vez por SHA. `.rotate()` aplica o EXIF; sem `withMetadata`, nada de EXIF/GPS/ICC sai. */
async function processarEmCache(f: Foto): Promise<string> {
  const ext = f.ehLogo ? "png" : "jpg";
  const destino = path.join(CACHE, `${f.sha}.${ext}`);
  if (fs.existsSync(destino)) return destino;
  const lado = f.ehLogo ? LADO_MAIOR_LOGO : LADO_MAIOR;
  const buf = await decodificar(f.fica.abs, f.fica.ext);
  let img = sharp(buf).rotate().resize(lado, lado, { fit: "inside", withoutEnlargement: true }).toColorspace("srgb");
  img = f.ehLogo
    ? img.png({ compressionLevel: 9 })
    : img.flatten({ background: "#ffffff" }).jpeg({ quality: QUALIDADE, mozjpeg: true });
  await img.toFile(destino);
  return destino;
}

// ---------------------------------------------------------------------------
// Arquivos de controle

const lerJson = <T>(p: string, padrao: T): T => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : padrao);

function escreverJsonOrdenado(p: string, obj: Record<string, unknown>) {
  const ordenado = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(p, JSON.stringify(ordenado, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Quase-duplicatas

/** União de conjuntos simples sobre os SHAs de um grupo. */
function agrupar(unidades: Unidade[], confirmados: string[][]): { grupos: Unidade[][]; auto: Set<string> } {
  const pai = new Map(unidades.map((u) => [u.sha, u.sha]));
  const raiz = (s: string): string => (pai.get(s) === s ? s : raiz(pai.get(s)!));
  const unir = (a: string, b: string) => pai.set(raiz(a), raiz(b));
  const auto = new Set<string>();

  for (const shas of confirmados) {
    const presentes = shas.filter((s) => pai.has(s));
    for (let i = 1; i < presentes.length; i++) unir(presentes[0], presentes[i]);
  }
  // pHash só dentro da mesma casa, nunca nos logos.
  for (let i = 0; i < unidades.length; i++) {
    for (let j = i + 1; j < unidades.length; j++) {
      const a = unidades[i];
      const b = unidades[j];
      if (a.grupo !== b.grupo || a.grupo === "comum") continue;
      if (hamming(a.phash, b.phash) <= PHASH_LIMITE && raiz(a.sha) !== raiz(b.sha)) {
        unir(a.sha, b.sha);
        auto.add(a.sha).add(b.sha);
      }
    }
  }
  const mapa = new Map<string, Unidade[]>();
  for (const u of unidades) mapa.set(raiz(u.sha), [...(mapa.get(raiz(u.sha)) ?? []), u]);
  return { grupos: Array.from(mapa.values()), auto };
}

/**
 * Fica a de maior resolução; se houver outras a até 10% dela, a retocada
 * ("Ret_") tem preferência; empate final pela ordem da curadoria.
 */
function vencedora(membros: Unidade[], curadoria: Record<string, Curadoria>): Unidade {
  const px = (u: Unidade) => u.largura * u.altura;
  const maior = Math.max(...membros.map(px));
  const candidatas = membros.filter((u) => px(u) >= maior * TOLERANCIA_RESOLUCAO);
  return [...candidatas].sort(
    (a, b) =>
      Number(b.retocada) - Number(a.retocada) ||
      px(b) - px(a) ||
      (curadoria[a.sha]?.ordem ?? 1e9) - (curadoria[b.sha]?.ordem ?? 1e9) ||
      a.sha.localeCompare(b.sha),
  )[0];
}

// ---------------------------------------------------------------------------
// Principal

async function main() {
  const comFolhas = process.argv.includes("--folhas");
  const origem = raizOrigem();
  console.log(`[galerias] origem: ${path.relative(RAIZ, origem)}`);

  const fontes = lerFontes(origem);
  const curadoria = lerJson<Record<string, Curadoria>>(ARQ_CURADORIA, {});
  const caminhos = lerJson<Record<string, string>>(ARQ_CAMINHOS, {});
  const confirmados = lerJson<{ descricao: string; shas: string[] }[]>(ARQ_QUASE, []);

  // 1. Uma unidade por SHA dentro do grupo, com todas as cópias nas pastas.
  const porChave = new Map<string, Fonte[]>();
  for (const f of fontes) porChave.set(`${f.grupo}:${f.sha}`, [...(porChave.get(`${f.grupo}:${f.sha}`) ?? []), f]);
  const unidades: Unidade[] = [];
  let n = 0;
  for (const lista of Array.from(porChave.values())) {
    const f0 = lista[0];
    const buf = await decodificar(path.join(origem, f0.origem), f0.ext);
    const meta = await sharp(buf).rotate().metadata();
    unidades.push({
      grupo: f0.grupo,
      sha: f0.sha,
      fontes: lista,
      largura: meta.autoOrient?.width ?? meta.width ?? 0,
      altura: meta.autoOrient?.height ?? meta.height ?? 0,
      retocada: lista.some((f) => /(^|[\s_])ret_/i.test(path.basename(f.origem))),
      phash: await phash(buf),
      abs: path.join(origem, f0.origem),
      ext: f0.ext,
    });
    if (++n % 40 === 0) console.log(`[galerias] ${n}/${porChave.size} lidas`);
  }

  // 2. Quase-duplicatas → uma foto por grupo, que herda todas as pastas.
  const { grupos, auto } = agrupar(unidades, confirmados.map((c) => c.shas));
  const fotos: Foto[] = [];
  const emUso = new Set(Object.values(caminhos));
  for (const membros of grupos) {
    const fica = vencedora(membros, curadoria);
    const todasFontes = membros.flatMap((m) => m.fontes);
    const ordemNaPasta: Record<string, number> = {};
    for (const f of todasFontes) {
      if (f.numero !== undefined) ordemNaPasta[f.pasta] = Math.min(ordemNaPasta[f.pasta] ?? Infinity, f.numero);
    }
    const pastas = ordenarPastas(todasFontes.map((f) => f.pasta));
    const ehLogo = fica.grupo === "comum";
    const ext0 = fica.fontes[0].ext;
    const cur = curadoria[fica.sha] ?? {};

    // Caminho no bucket: o congelado; foto nova ganha um e ele fica registrado.
    let arquivo = caminhos[fica.sha];
    const novo = !arquivo;
    if (!arquivo) {
      const pastaBucket =
        fica.grupo === "solarium-1" || fica.grupo === "solarium-2"
          ? `${fica.grupo}/${pastas[0]}`
          : fica.grupo === "comum"
            ? "comum/marca"
            : fica.grupo;
      const descricao = cur.descricao ?? descricaoDoNomeOriginal(path.basename(fica.fontes[0].origem));
      arquivo = `${pastaBucket}/${nomeFinal(pastaBucket, descricao, ehLogo ? "png" : "jpg", emUso)}`;
      caminhos[fica.sha] = arquivo;
    }

    fotos.push({
      grupo: fica.grupo,
      sha: fica.sha,
      fica,
      membros,
      pastas,
      ordemNaPasta,
      cur,
      ehLogo,
      convertido: ext0 === "heic" || ext0 === "heif" ? "heic" : ext0 === "png" && !ehLogo ? "png" : null,
      arquivo,
      novo,
      ordem: 0,
      largura: 0,
      altura: 0,
      autoGrupo: membros.length > 1 && membros.some((m) => auto.has(m.sha)),
    });
  }

  // 3. Saída limpa a cada rodada (menos o cache e a revisão).
  fs.mkdirSync(CACHE, { recursive: true });
  for (const e of fs.readdirSync(SAIDA)) {
    if (e === ".cache" || e === "_revisao") continue;
    fs.rmSync(path.join(SAIDA, e), { recursive: true, force: true });
  }

  // 4. Ordem geral por grupo: a da curadoria; foto nova vai para o fim.
  for (const g of GRUPOS_ORDEM) {
    fotos
      .filter((f) => f.grupo === g)
      .sort((a, b) => (a.cur.ordem ?? 1e9) - (b.cur.ordem ?? 1e9) || a.sha.localeCompare(b.sha))
      .forEach((f, i) => (f.ordem = i + 1));
  }

  // 5. Converte (cache por SHA) e copia com o caminho do bucket.
  for (const f of fotos) {
    const cache = await processarEmCache(f);
    const destino = path.join(SAIDA, f.arquivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(cache, destino);
    const meta = await sharp(destino).metadata();
    f.largura = meta.width!;
    f.altura = meta.height!;
  }

  // 6. Manifestos. Nada é excluído automaticamente: o que está na pasta aparece.
  fs.mkdirSync(DIR_MANIFESTOS, { recursive: true });
  const manifestos: Record<string, ItemGaleria[]> = {};
  for (const g of GRUPOS_ORDEM) {
    const doGrupo = fotos.filter((f) => f.grupo === g).sort((a, b) => a.ordem - b.ordem);
    manifestos[g] = doGrupo.map((f) => {
      const [ambiente, ...tambemEm] = f.pastas;
      const item: ItemGaleria = {
        arquivo: f.arquivo,
        largura: f.largura,
        altura: f.altura,
        alt: f.cur.alt ?? descricaoDoNomeOriginal(path.basename(f.fica.fontes[0].origem)).replace(/-/g, " "),
        ambiente,
        pastas: f.pastas,
        estacao: f.cur.estacao ?? "neutra",
        destaque: false,
        ordem: f.ordem,
        tambemEm,
        baixaResolucao: Math.max(f.fica.largura, f.fica.altura) < LIMITE_BAIXA_RESOLUCAO,
        excluirDoSite: false,
        creditoPendente: g === "experiencias",
        marcaDagua: f.cur.marcaDagua ?? false,
        telaComConteudo: f.cur.telaComConteudo ?? false,
      };
      if (Object.keys(f.ordemNaPasta).length) item.ordemNaPasta = f.ordemNaPasta;
      // Capa: a da curadoria, se continua numa pasta e pode ser vitrine.
      item.destaque = Boolean(f.cur.destaque) && podeSerVitrine(item);
      return item;
    });
    fs.writeFileSync(path.join(DIR_MANIFESTOS, `${g}.json`), JSON.stringify(manifestos[g], null, 2) + "\n");
  }
  escreverJsonOrdenado(ARQ_CAMINHOS, caminhos);

  // 7. Google Perfil da Empresa: 4:3, lado maior 1600, só o que pode ser vitrine.
  const itemDe = new Map(Object.values(manifestos).flat().map((i) => [i.arquivo, i]));
  const selecao = fotos
    .filter((f) => f.cur.gmb && podeSerVitrine(itemDe.get(f.arquivo)!))
    .sort((a, b) => Number(b.cur.gmbCapa ?? false) - Number(a.cur.gmbCapa ?? false));
  fs.mkdirSync(GMB, { recursive: true });
  for (let i = 0; i < selecao.length; i++) {
    const f = selecao[i];
    await sharp(path.join(SAIDA, f.arquivo))
      .resize(GMB_LADO, (GMB_LADO * 3) / 4, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(path.join(GMB, `${String(i + 1).padStart(2, "0")}-${f.grupo}-${path.basename(f.arquivo)}`));
  }

  if (comFolhas) await folhasDeContato(fotos);

  // 8. Mapa local (nomes originais → destino). Fora do git: tem nome de hóspede.
  fs.writeFileSync(
    path.join(SAIDA, "_origem.json"),
    JSON.stringify(
      fotos.map((f) => ({
        arquivo: f.arquivo,
        sha: f.sha,
        pastas: f.pastas,
        origens: f.membros.flatMap((m) => m.fontes.map((x) => ({ origem: x.origem, pasta: x.pasta, sha: x.sha }))),
      })),
      null,
      2,
    ),
  );

  escreverRelatorio(fontes, fotos, selecao, manifestos, confirmados);
  const novos = fotos.filter((f) => f.novo).length;
  console.log(`[galerias] ok — ${fotos.length} fotos (${novos} novas) em ${path.relative(RAIZ, SAIDA)}, ${selecao.length} em gmb/`);
}

// ---------------------------------------------------------------------------
// Folhas de contato para a revisão visual (rótulos A01, B02…)

async function folhasDeContato(fotos: Foto[]) {
  fs.mkdirSync(REVISAO, { recursive: true });
  const COLS = 4;
  const LINHAS = 3;
  const W = 480;
  const H = 360;
  const ROTULO = 34;
  const indice: Record<string, unknown> = {};
  const prefixo: Record<Grupo, string> = { "solarium-1": "A", "solarium-2": "B", completo: "C", experiencias: "E", comum: "M" };
  for (const g of GRUPOS_ORDEM) {
    const lista = fotos.filter((f) => f.grupo === g).sort((a, b) => a.ordem - b.ordem);
    for (let pag = 0; pag * COLS * LINHAS < lista.length; pag++) {
      const fatia = lista.slice(pag * COLS * LINHAS, (pag + 1) * COLS * LINHAS);
      const comp: sharp.OverlayOptions[] = [];
      for (let i = 0; i < fatia.length; i++) {
        const f = fatia[i];
        const rotulo = `${prefixo[g]}${String(pag * COLS * LINHAS + i + 1).padStart(2, "0")}`;
        indice[rotulo] = { sha: f.sha, arquivo: f.arquivo, pastas: f.pastas };
        const x = (i % COLS) * W;
        const y = Math.floor(i / COLS) * (H + ROTULO);
        comp.push({
          input: await sharp(path.join(SAIDA, f.arquivo)).resize(W, H, { fit: "contain", background: "#222222" }).flatten({ background: "#222222" }).toBuffer(),
          left: x,
          top: y,
        });
        comp.push({
          input: Buffer.from(
            `<svg width="${W}" height="${ROTULO}"><rect width="100%" height="100%" fill="#000"/><text x="8" y="24" font-family="Arial" font-size="20" fill="#ff0">${rotulo}  ${f.pastas.join(",")}</text></svg>`,
          ),
          left: x,
          top: y + H,
        });
      }
      await sharp({ create: { width: COLS * W, height: LINHAS * (H + ROTULO), channels: 3, background: "#111111" } })
        .composite(comp)
        .jpeg({ quality: 80 })
        .toFile(path.join(REVISAO, `${g}-${String(pag + 1).padStart(2, "0")}.jpg`));
    }
  }
  fs.writeFileSync(path.join(REVISAO, "indice.json"), JSON.stringify(indice, null, 2));
}

// ---------------------------------------------------------------------------
// Relatório (sem nomes originais: vários têm nome de hóspede)

function escreverRelatorio(
  fontes: Fonte[],
  fotos: Foto[],
  selecao: Foto[],
  manifestos: Record<string, ItemGaleria[]>,
  confirmados: { descricao: string; shas: string[] }[],
) {
  const linhas: string[] = [];
  const L = (s = "") => linhas.push(s);
  const semNome = (f: Fonte) => `${f.pasta}/${descricaoDoNomeOriginal(path.basename(f.origem))}`;
  const itens = Object.values(manifestos).flat();
  const unidades = fotos.reduce((s, f) => s + f.membros.length, 0);
  const grupos = fotos.filter((f) => f.membros.length > 1);

  L("# Relatório de imagens");
  L();
  L("Gerado por `npm run galerias:preparar`. Não editar à mão.");
  L("Nomes originais não aparecem aqui: vários trazem nome de hóspede.");
  L("**As pastas de `galerias-local/` decidem o que aparece e em qual chip.**");
  L();
  L("## Números");
  L();
  L(`- Arquivos de imagem nas pastas: **${fontes.length}**`);
  L(`- Ignorados (não são imagem ou pasta fora do escopo): ${ignorados.length}`);
  L(`- Imagens distintas (SHA-256): **${unidades}** — a diferença são cópias idênticas em mais de uma pasta`);
  L(`- Grupos de quase-duplicatas: **${grupos.length}** (${grupos.reduce((s, f) => s + f.membros.length - 1, 0)} versões fora do site)`);
  L(`- Fotos no site: **${fotos.length}**`);
  L(`- Fotos novas nesta rodada (sem curadoria de alt/estação): **${fotos.filter((f) => f.novo).length}**`);
  L(`- Convertidos de HEIC/PNG para JPG: **${fotos.filter((f) => f.convertido).length}**`);
  L(`- Baixa resolução (lado maior < ${LIMITE_BAIXA_RESOLUCAO}px no original): **${itens.filter((i) => i.baixaResolucao).length}**`);
  L(`- Com marca d'água "T": **${itens.filter((i) => i.marcaDagua).length}** — fora de capa, mosaico e Google`);
  L(`- Com tela mostrando conteúdo: **${itens.filter((i) => i.telaComConteudo).length}** — fora de capa, mosaico e Google`);
  L();

  L("## Fotos por chip × arquivos na pasta");
  L();
  L("\"Arquivos\" conta o que está na pasta; \"No chip\" conta fotos distintas (cópias idênticas e quase-duplicatas da mesma pasta viram uma).");
  L();
  L("| Casa | Chip (pasta) | Arquivos na pasta | No chip |");
  L("|---|---|---:|---:|");
  for (const g of GRUPOS_ORDEM) {
    const pastas = ordenarPastas(fontes.filter((f) => f.grupo === g).map((f) => f.pasta));
    for (const p of pastas) {
      const arquivos = fontes.filter((f) => f.grupo === g && f.pasta === p).length;
      const noChip = manifestos[g].filter((i) => (i.pastas ?? [i.ambiente]).includes(p)).length;
      L(`| ${g} | ${rotuloDaPasta(p)} (\`${p}\`) | ${arquivos} | ${noChip} |`);
    }
    L(`| **${g}** | **Todas** | **${fontes.filter((f) => f.grupo === g).length}** | **${manifestos[g].length}** |`);
  }
  L();

  L("## Quase-duplicatas");
  L();
  L("Mesma cena em recorte ou edição diferente. Fica uma (maior resolução; entre as de resolução parecida, a retocada \"Ret_\"), que herda as pastas de todas. Miniaturas lado a lado na folha de contato (`npm run galerias:folha`).");
  L();
  for (const f of grupos) {
    const conf = confirmados.find((c) => f.membros.some((m) => c.shas.includes(m.sha)));
    const origemGrupo = conf ? `confirmado: ${conf.descricao}` : f.autoGrupo ? "detectado por pHash" : "";
    const fora = f.membros.filter((m) => m.sha !== f.sha).map((m) => `\`${semNome(m.fontes[0])}\` (${m.largura}×${m.altura})`);
    L(`- **\`${f.arquivo}\`** (${f.fica.largura}×${f.fica.altura}) — ${origemGrupo}. Fora do site: ${fora.join(", ")}. Chips: ${f.pastas.map(rotuloDaPasta).join(", ")}.`);
  }
  L();

  L("## Mesma foto em mais de uma pasta");
  L();
  for (const f of fotos.filter((x) => x.pastas.length > 1)) L(`- \`${f.arquivo}\` → ${f.pastas.map(rotuloDaPasta).join(", ")}`);
  L();

  const novos = fotos.filter((f) => f.novo);
  if (novos.length) {
    L("## Fotos novas (alt provisório — revisar)");
    L();
    for (const f of novos) L(`- \`${f.arquivo}\` (${f.pastas.map(rotuloDaPasta).join(", ")})`);
    L();
  }

  L("## Convertidos de HEIC/PNG");
  L();
  for (const f of fotos.filter((x) => x.convertido)) L(`- \`${f.arquivo}\` (${f.convertido})`);
  L();

  L("## Baixa resolução");
  L();
  L("Aparecem na galeria; nunca são capa, mosaico ou Google.");
  L();
  for (const f of fotos) {
    if (Math.max(f.fica.largura, f.fica.altura) < LIMITE_BAIXA_RESOLUCAO) L(`- \`${f.arquivo}\` — original ${f.fica.largura}x${f.fica.altura}`);
  }
  L();

  L("## Marca d'água \"T\"");
  L();
  for (const i of itens.filter((x) => x.marcaDagua)) L(`- \`${i.arquivo}\``);
  L();
  L("## Tela com conteúdo (Netflix ou outra interface)");
  L();
  for (const i of itens.filter((x) => x.telaComConteudo)) L(`- \`${i.arquivo}\``);
  L();

  L("## Capas");
  L();
  for (const g of GRUPOS_ORDEM) {
    const capa = manifestos[g].find((i) => i.destaque);
    if (capa) L(`- ${g}: \`${capa.arquivo}\``);
  }
  L();

  L(`## Google Perfil da Empresa — ${selecao.length} fotos recomendadas`);
  L();
  L("Cópias em 4:3, lado maior 1600px, em `galerias-processadas/gmb/` (subir à mão).");
  L();
  selecao.forEach((f, i) => L(`${i + 1}. \`${f.arquivo}\`${f.cur.gmbCapa ? " — **sugestão de capa**" : ""}`));
  L();

  fs.writeFileSync(ARQ_RELATORIO, linhas.join("\n"));
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
