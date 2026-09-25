#!/usr/bin/env tsx
/**
 * IMG-0 — prepara as fotos do Drive para o Supabase Storage.
 *
 *   npm run galerias:preparar            processa, gera manifestos, relatório e gmb/
 *   npm run galerias:preparar -- --folhas  também gera folhas de contato para revisão
 *
 * Origem: `GALERIAS_LOCAL_DIR` ou `./galerias-local/` (aceita um nível extra,
 * como `galerias-local/Solarium/casas`). Saída: `./galerias-processadas/`,
 * reconstruída do zero a cada rodada (idempotente); o recorte/conversão de
 * cada foto fica em cache por SHA-256 em `.cache/`.
 *
 * A curadoria visual (alt, estação, descrição, ordem, destaque, exclusão,
 * seleção do Google) mora em `content/galerias/curadoria.json`, chaveada pelo
 * SHA-256 do arquivo original. Nomes originais nunca vão para o repositório:
 * vários têm nome de hóspede.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import heicConvert from "heic-convert";
import {
  slug,
  normalizarAmbiente,
  prioridadeAmbiente,
  descricaoDoNomeOriginal,
  nomeFinal,
} from "./galerias/nomes";
import type { Estacao, Grupo, ItemGaleria } from "../src/lib/galerias/manifesto";

const RAIZ = path.resolve(__dirname, "..");
const SAIDA = path.join(RAIZ, "galerias-processadas");
const CACHE = path.join(SAIDA, ".cache");
const REVISAO = path.join(SAIDA, "_revisao");
const GMB = path.join(SAIDA, "gmb");
const DIR_MANIFESTOS = path.join(RAIZ, "content", "galerias");
const ARQ_CURADORIA = path.join(DIR_MANIFESTOS, "curadoria.json");
const ARQ_RELATORIO = path.join(RAIZ, "RELATORIO_IMAGENS.md");

const LADO_MAIOR = 2400;
const LADO_MAIOR_LOGO = 1200;
const LIMITE_BAIXA_RESOLUCAO = 1600;
const QUALIDADE = 82;
const GMB_LADO = 1600;

const EXT_IMAGEM = /\.(jpe?g|png|heic|heif)$/i;

// ---------------------------------------------------------------------------
// Tipos

type Curadoria = {
  /** Reclassifica pelo conteúdo (ex.: foto da pasta "banheiro" que mostra o SPA). */
  ambiente?: string;
  descricao?: string;
  alt?: string;
  estacao?: Estacao;
  ordem?: number;
  destaque?: boolean;
  excluirDoSite?: boolean;
  motivoExclusao?: string;
  gmb?: boolean;
  gmbCapa?: boolean;
};

type Fonte = {
  grupo: Grupo;
  ambiente: string;
  /** Caminho relativo à raiz de origem. Só local, nunca vai para o git. */
  origem: string;
  sha: string;
  ext: string;
  bytes: number;
};

type Registro = {
  grupo: Grupo;
  sha: string;
  ambiente: string;
  tambemEm: string[];
  duplicatas: Fonte[];
  fonte: Fonte;
  ehLogo: boolean;
  larguraOriginal: number;
  alturaOriginal: number;
  nitidez: number;
  convertido: "heic" | "png" | null;
  cur: Curadoria;
  // preenchidos depois
  ordem?: number;
  arquivo?: string;
  largura?: number;
  altura?: number;
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

/** Pastas de origem → grupo de destino. O resto (pacotes, social, vídeo…) é ignorado. */
const MAPA: { pasta: string; grupo: Grupo; ambienteFixo?: string }[] = [
  { pasta: "casas/solarium-1", grupo: "solarium-1" },
  { pasta: "casas/solarium-2", grupo: "solarium-2" },
  { pasta: "casas/solarium-completo", grupo: "completo" },
  { pasta: "experiencias", grupo: "experiencias", ambienteFixo: "experiencias" },
  { pasta: "marca", grupo: "comum", ambienteFixo: "marca" },
];

function listar(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [p];
  });
}

const ignorados: string[] = [];

function lerFontes(origem: string): Fonte[] {
  const fontes: Fonte[] = [];
  for (const { pasta, grupo, ambienteFixo } of MAPA) {
    const base = path.join(origem, pasta);
    for (const abs of listar(base)) {
      const rel = path.relative(origem, abs).replace(/\\/g, "/");
      if (!EXT_IMAGEM.test(abs)) {
        ignorados.push(rel);
        continue;
      }
      const dentro = path.relative(base, abs).split(path.sep);
      const pastaAmbiente = dentro.length > 1 ? dentro[0] : null;
      const buf = fs.readFileSync(abs);
      fontes.push({
        grupo,
        ambiente: ambienteFixo ?? normalizarAmbiente(pastaAmbiente),
        origem: rel,
        sha: crypto.createHash("sha256").update(buf).digest("hex"),
        ext: path.extname(abs).slice(1).toLowerCase(),
        bytes: buf.length,
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

/** Variância do laplaciano numa versão de 800px: número baixo = foto sem foco. */
async function medirNitidez(buf: Buffer): Promise<number> {
  const { data } = await sharp(buf)
    .rotate()
    .greyscale()
    .resize(800, 800, { fit: "inside" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let soma = 0;
  let soma2 = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    soma += v;
    soma2 += v * v;
  }
  const n = data.length;
  return Math.round(soma2 / n - (soma / n) ** 2);
}

/** Converte uma vez por SHA. `.rotate()` aplica o EXIF; sem `withMetadata`, nada de EXIF/GPS/ICC sai. */
async function processarEmCache(reg: Registro, origem: string): Promise<string> {
  const ext = reg.ehLogo ? "png" : "jpg";
  const destino = path.join(CACHE, `${reg.sha}.${ext}`);
  if (fs.existsSync(destino)) return destino;

  const buf = await decodificar(path.join(origem, reg.fonte.origem), reg.fonte.ext);
  const lado = reg.ehLogo ? LADO_MAIOR_LOGO : LADO_MAIOR;
  let img = sharp(buf)
    .rotate()
    .resize(lado, lado, { fit: "inside", withoutEnlargement: true })
    .toColorspace("srgb");
  img = reg.ehLogo
    ? img.png({ compressionLevel: 9 })
    : img.flatten({ background: "#ffffff" }).jpeg({ quality: QUALIDADE, mozjpeg: true });
  await img.toFile(destino);
  return destino;
}

// ---------------------------------------------------------------------------
// Curadoria e ordem

function lerCuradoria(): Record<string, Curadoria> {
  if (!fs.existsSync(ARQ_CURADORIA)) return {};
  return JSON.parse(fs.readFileSync(ARQ_CURADORIA, "utf8"));
}

function pastaDestino(reg: Registro): string {
  if (reg.grupo === "solarium-1" || reg.grupo === "solarium-2") return `${reg.grupo}/${reg.ambiente}`;
  if (reg.grupo === "comum") return "comum/marca";
  return reg.grupo;
}

/**
 * Ordem final: a da curadoria; o que não tem curadoria vai depois, por
 * prioridade de ambiente. Renumerado 1..N, e `nn` do nome segue esta ordem.
 */
function ordenar(regs: Registro[]): Registro[] {
  return [...regs]
    .sort((a, b) => {
      const oa = a.cur.ordem ?? Number.MAX_SAFE_INTEGER;
      const ob = b.cur.ordem ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const pa = prioridadeAmbiente(a.ambiente);
      const pb = prioridadeAmbiente(b.ambiente);
      if (pa !== pb) return pa - pb;
      return a.sha.localeCompare(b.sha);
    })
    .map((r, i) => ({ ...r, ordem: i + 1 }));
}

function altProvisorio(reg: Registro): string {
  return descricaoDoNomeOriginal(path.basename(reg.fonte.origem)).replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// Folhas de contato

async function folhasDeContato(regs: Registro[]) {
  fs.mkdirSync(REVISAO, { recursive: true });
  const COLS = 4;
  const LINHAS = 3;
  const W = 480;
  const H = 360;
  const ROTULO = 34;
  const indice: Record<string, unknown> = {};

  const porGrupo = new Map<Grupo, Registro[]>();
  for (const r of regs) porGrupo.set(r.grupo, [...(porGrupo.get(r.grupo) ?? []), r]);

  for (const [grupo, lista] of Array.from(porGrupo)) {
    const prefixo: string = ({ "solarium-1": "A", "solarium-2": "B", completo: "C", experiencias: "E", comum: "M" } as Record<Grupo, string>)[grupo];
    for (let pag = 0; pag * COLS * LINHAS < lista.length; pag++) {
      const fatia = lista.slice(pag * COLS * LINHAS, (pag + 1) * COLS * LINHAS);
      const composicao: sharp.OverlayOptions[] = [];
      for (let i = 0; i < fatia.length; i++) {
        const r = fatia[i];
        const n = pag * COLS * LINHAS + i + 1;
        const rotulo = `${prefixo}${String(n).padStart(2, "0")}`;
        indice[rotulo] = {
          sha: r.sha,
          origem: r.fonte.origem,
          ambiente: r.ambiente,
          tambemEm: r.tambemEm,
          original: `${r.larguraOriginal}x${r.alturaOriginal}`,
          nitidez: r.nitidez,
        };
        const x = (i % COLS) * W;
        const y = Math.floor(i / COLS) * (H + ROTULO);
        const thumb = await sharp(path.join(CACHE, `${r.sha}.${r.ehLogo ? "png" : "jpg"}`))
          .resize(W, H, { fit: "contain", background: "#222222" })
          .flatten({ background: "#222222" })
          .toBuffer();
        composicao.push({ input: thumb, left: x, top: y });
        const texto = `${rotulo}  ${r.ambiente}  nit ${r.nitidez}${r.larguraOriginal < 1600 && r.alturaOriginal < 1600 ? "  BAIXA" : ""}`;
        const svg = Buffer.from(
          `<svg width="${W}" height="${ROTULO}"><rect width="100%" height="100%" fill="#000"/><text x="8" y="24" font-family="Arial" font-size="20" fill="#ff0">${texto}</text></svg>`,
        );
        composicao.push({ input: svg, left: x, top: y + H });
      }
      await sharp({
        create: { width: COLS * W, height: LINHAS * (H + ROTULO), channels: 3, background: "#111111" },
      })
        .composite(composicao)
        .jpeg({ quality: 80 })
        .toFile(path.join(REVISAO, `${grupo}-${String(pag + 1).padStart(2, "0")}.jpg`));
    }
  }
  fs.writeFileSync(path.join(REVISAO, "indice.json"), JSON.stringify(indice, null, 2));
}

// ---------------------------------------------------------------------------
// Principal

async function main() {
  const comFolhas = process.argv.includes("--folhas");
  const origem = raizOrigem();
  console.log(`[galerias] origem: ${path.relative(RAIZ, origem)}`);

  const fontes = lerFontes(origem);
  const curadoria = lerCuradoria();

  // Duplicatas por SHA dentro do mesmo grupo: fica a pasta mais específica.
  const porChave = new Map<string, Fonte[]>();
  for (const f of fontes) {
    const k = `${f.grupo}:${f.sha}`;
    porChave.set(k, [...(porChave.get(k) ?? []), f]);
  }

  const regs: Registro[] = [];
  for (const grupoFontes of Array.from(porChave.values())) {
    const ordenadas = [...grupoFontes].sort(
      (a, b) => prioridadeAmbiente(a.ambiente) - prioridadeAmbiente(b.ambiente) || a.origem.localeCompare(b.origem),
    );
    const [fica, ...resto] = ordenadas;
    const buf = await decodificar(path.join(origem, fica.origem), fica.ext);
    const meta = await sharp(buf).rotate().metadata();
    const ehLogo = fica.grupo === "comum";
    const cur = curadoria[fica.sha] ?? {};
    const ambiente = cur.ambiente ?? fica.ambiente;
    regs.push({
      grupo: fica.grupo,
      sha: fica.sha,
      ambiente,
      // Toda pasta de origem que não é a final, inclusive a original quando a curadoria reclassificou.
      tambemEm: Array.from(new Set(ordenadas.map((r) => r.ambiente).filter((a) => a !== ambiente))).sort(),
      duplicatas: resto,
      fonte: fica,
      ehLogo,
      larguraOriginal: meta.autoOrient?.width ?? meta.width ?? 0,
      alturaOriginal: meta.autoOrient?.height ?? meta.height ?? 0,
      nitidez: ehLogo ? 0 : await medirNitidez(buf),
      convertido: fica.ext === "heic" || fica.ext === "heif" ? "heic" : fica.ext === "png" && !ehLogo ? "png" : null,
      cur,
    });
  }

  // Saída limpa a cada rodada (menos o cache e a revisão).
  fs.mkdirSync(CACHE, { recursive: true });
  for (const e of fs.readdirSync(SAIDA)) {
    if (e === ".cache" || e === "_revisao") continue;
    fs.rmSync(path.join(SAIDA, e), { recursive: true, force: true });
  }

  let n = 0;
  for (const r of regs) {
    await processarEmCache(r, origem);
    if (++n % 20 === 0) console.log(`[galerias] ${n}/${regs.length} convertidas`);
  }

  // Ordem, nome e dimensões finais por grupo.
  const finais: Registro[] = [];
  for (const grupo of ["solarium-1", "solarium-2", "completo", "experiencias", "comum"] as Grupo[]) {
    for (const r of ordenar(regs.filter((x) => x.grupo === grupo))) {
      const ext = r.ehLogo ? "png" : "jpg";
      const descricao = r.cur.descricao ?? descricaoDoNomeOriginal(path.basename(r.fonte.origem));
      const arquivo = `${pastaDestino(r)}/${nomeFinal(r.ordem!, descricao, ext)}`;
      const cache = path.join(CACHE, `${r.sha}.${ext}`);
      const destino = path.join(SAIDA, arquivo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(cache, destino);
      const meta = await sharp(destino).metadata();
      finais.push({ ...r, arquivo, largura: meta.width!, altura: meta.height! });
    }
  }

  // Manifestos.
  fs.mkdirSync(DIR_MANIFESTOS, { recursive: true });
  const manifestos: Record<string, ItemGaleria[]> = {};
  for (const r of finais) {
    const baixa = Math.max(r.larguraOriginal, r.alturaOriginal) < LIMITE_BAIXA_RESOLUCAO;
    const excluir = r.cur.excluirDoSite ?? false;
    const item: ItemGaleria = {
      arquivo: r.arquivo!,
      largura: r.largura!,
      altura: r.altura!,
      alt: r.cur.alt ?? altProvisorio(r),
      ambiente: r.ambiente,
      estacao: r.cur.estacao ?? "neutra",
      destaque: (r.cur.destaque ?? false) && !baixa && !excluir,
      ordem: r.ordem!,
      tambemEm: r.tambemEm,
      baixaResolucao: baixa,
      excluirDoSite: excluir,
      creditoPendente: r.grupo === "experiencias",
    };
    (manifestos[r.grupo] ??= []).push(item);
  }
  for (const [grupo, itens] of Object.entries(manifestos)) {
    fs.writeFileSync(path.join(DIR_MANIFESTOS, `${grupo}.json`), JSON.stringify(itens, null, 2) + "\n");
  }

  // Google Perfil da Empresa: 4:3, lado maior 1600.
  const selecao = finais
    .filter((r) => r.cur.gmb)
    .sort((a, b) => Number(b.cur.gmbCapa ?? false) - Number(a.cur.gmbCapa ?? false));
  fs.mkdirSync(GMB, { recursive: true });
  for (let i = 0; i < selecao.length; i++) {
    const r = selecao[i];
    const nome = `${String(i + 1).padStart(2, "0")}-${r.grupo}-${path.basename(r.arquivo!)}`;
    await sharp(path.join(SAIDA, r.arquivo!))
      .resize(GMB_LADO, (GMB_LADO * 3) / 4, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(path.join(GMB, nome));
  }

  if (comFolhas) await folhasDeContato(finais);

  // Mapa local (nome original → destino) só para conferência humana. Fica
  // em galerias-processadas/, fora do git.
  fs.writeFileSync(
    path.join(SAIDA, "_origem.json"),
    JSON.stringify(
      finais.map((r) => ({ arquivo: r.arquivo, origem: r.fonte.origem, duplicatas: r.duplicatas.map((d) => d.origem) })),
      null,
      2,
    ),
  );

  escreverRelatorio(fontes, finais, selecao, manifestos);
  console.log(`[galerias] ok — ${finais.length} arquivos em ${path.relative(RAIZ, SAIDA)}, ${selecao.length} em gmb/`);
}

// ---------------------------------------------------------------------------
// Relatório (sem nomes originais: vários têm nome de hóspede)

function escreverRelatorio(
  fontes: Fonte[],
  finais: Registro[],
  selecao: Registro[],
  manifestos: Record<string, ItemGaleria[]>,
) {
  const linhas: string[] = [];
  const L = (s = "") => linhas.push(s);
  const semNome = (f: Fonte) => `${f.ambiente}/${descricaoDoNomeOriginal(path.basename(f.origem))}`;

  L("# Relatório de imagens — IMG-0");
  L();
  L("Gerado por `npm run galerias:preparar`. Não editar à mão.");
  L("Nomes originais não aparecem aqui: vários trazem nome de hóspede.");
  L();
  L("## Números");
  L();
  const dup = finais.reduce((s, r) => s + r.duplicatas.length, 0);
  const conv = finais.filter((r) => r.convertido);
  const itens = Object.values(manifestos).flat();
  L(`- Arquivos de imagem lidos: **${fontes.length}**`);
  L(`- Ignorados (não são imagem ou pasta fora do escopo): ${ignorados.length}`);
  L(`- Duplicatas removidas (mesmo SHA-256): **${dup}**`);
  L(`- Fotos únicas processadas: **${finais.length}**`);
  L(`- Convertidos de HEIC/PNG para JPG: **${conv.length}**`);
  L(`- Baixa resolução (lado maior < ${LIMITE_BAIXA_RESOLUCAO}px no original): **${itens.filter((i) => i.baixaResolucao).length}**`);
  L(`- Excluídos do site: **${itens.filter((i) => i.excluirDoSite).length}**`);
  L();

  L("## Fotos por casa e por ambiente");
  L();
  L("| Grupo | Ambiente | Total | No site |");
  L("|---|---|---:|---:|");
  for (const [grupo, lista] of Object.entries(manifestos)) {
    const amb = new Map<string, ItemGaleria[]>();
    for (const i of lista) amb.set(i.ambiente, [...(amb.get(i.ambiente) ?? []), i]);
    for (const [a, l] of Array.from(amb).sort(([x], [y]) => x.localeCompare(y))) L(`| ${grupo} | ${a} | ${l.length} | ${l.filter((i) => !i.excluirDoSite).length} |`);
    L(`| **${grupo}** | **todos** | **${lista.length}** | **${lista.filter((i) => !i.excluirDoSite).length}** |`);
  }
  L();

  L("## Duplicatas removidas");
  L();
  L("Ficou a cópia da pasta mais específica; as outras pastas estão em `tambemEm`.");
  L();
  for (const r of finais.filter((x) => x.duplicatas.length)) {
    L(`- \`${r.arquivo}\` — removidas: ${r.duplicatas.map((d) => `\`${semNome(d)}\``).join(", ")}`);
  }
  L();

  L("## Convertidos de HEIC/PNG");
  L();
  for (const r of conv) L(`- \`${r.arquivo}\` (${r.convertido})`);
  L();

  L("## Baixa resolução");
  L();
  L("Processadas normalmente; nunca são capa.");
  L();
  for (const r of finais) {
    if (Math.max(r.larguraOriginal, r.alturaOriginal) < LIMITE_BAIXA_RESOLUCAO) {
      L(`- \`${r.arquivo}\` — original ${r.larguraOriginal}x${r.alturaOriginal}`);
    }
  }
  L();

  L("## Excluídos do site");
  L();
  L("O arquivo segue no Storage; só não aparece no site.");
  L();
  for (const r of finais.filter((x) => x.cur.excluirDoSite)) {
    L(`- \`${r.arquivo}\` — ${r.cur.motivoExclusao ?? "sem motivo registrado"}`);
  }
  L();

  L("## Capas");
  L();
  for (const [grupo, lista] of Object.entries(manifestos)) {
    const capa = lista.find((i) => i.destaque);
    if (capa) L(`- ${grupo}: \`${capa.arquivo}\``);
  }
  L();

  L("## Google Perfil da Empresa — 25 fotos recomendadas");
  L();
  L("Cópias em 4:3, lado maior 1600px, em `galerias-processadas/gmb/` (subir à mão).");
  L();
  selecao.forEach((r, i) => L(`${i + 1}. \`${r.arquivo}\`${r.cur.gmbCapa ? " — **sugestão de capa**" : ""}`));
  L();

  fs.writeFileSync(ARQ_RELATORIO, linhas.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
