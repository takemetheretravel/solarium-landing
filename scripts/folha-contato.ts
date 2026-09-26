#!/usr/bin/env tsx
/**
 * Folha de contato local para o Lucas conferir as galerias.
 *
 *   npm run galerias:folha  →  galerias-processadas/folha-contato.html
 *
 * Mostra todas as fotos do site agrupadas por casa e pasta (= chip), com o
 * caminho no bucket, os chips em que aparecem e as marcações; e, no topo, os
 * grupos de quase-duplicatas lado a lado (a que ficou e as que saíram). As
 * miniaturas são os arquivos locais de `galerias-processadas/` — a folha fica
 * fora do git e do bucket e funciona offline.
 */
import fs from "fs";
import path from "path";

// A biblioteca do site exige a URL; a folha não a usa (miniaturas locais).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://local.invalid";

import { chipsDoItem, podeAparecer, podeSerVitrine, pastasDoItem } from "../src/lib/galerias";
import { GRUPOS, type Grupo, type ItemGaleria } from "../src/lib/galerias/manifesto";
import { ordenarPastas, rotuloDaPasta } from "../src/lib/galerias/pastas";

const RAIZ = path.resolve(__dirname, "..");
const PROCESSADAS = path.join(RAIZ, "galerias-processadas");
const DIR = path.join(RAIZ, "content", "galerias");
const SAIDA = path.join(PROCESSADAS, "folha-contato.html");

type Origem = { arquivo: string; sha: string; pastas: string[]; origens: { origem: string; pasta: string; sha: string }[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ler = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8"));

function card(i: ItemGaleria, g: Grupo): string {
  const aparece = podeAparecer(i);
  const selos = [
    !aparece && `<b class="x">fora do site${i.creditoPendente && !i.credito ? ": falta o crédito" : ""}</b>`,
    i.destaque && `<b class="ok">capa</b>`,
    i.marcaDagua && `<b class="m">marca d'água</b>`,
    i.telaComConteudo && `<b class="m">tela com conteúdo</b>`,
    i.baixaResolucao && `<b class="m">baixa resolução</b>`,
    i.creditoPendente && `<b class="m">crédito pendente${i.credito ? `: ${esc(i.credito)}` : ""}</b>`,
    aparece && !podeSerVitrine(i) && `<b class="m">fora de capa/mosaico/Google</b>`,
  ].filter(Boolean);
  const chips = ["solarium-1", "solarium-2", "completo"].includes(g) ? chipsDoItem(i).map(rotuloDaPasta) : [];
  const numeros = Object.entries(i.ordemNaPasta ?? {}).map(([p, n]) => `${rotuloDaPasta(p)} nº ${n}`);
  return `<figure class="${aparece ? "" : "fora"}">
  <a href="${esc(i.arquivo)}" target="_blank"><img loading="lazy" src="${esc(i.arquivo)}" alt="${esc(i.alt)}"></a>
  <figcaption><code>${esc(i.arquivo)}</code>
  <span class="chips">${chips.map((c) => `<i>${esc(c)}</i>`).join(" ")}</span>
  ${selos.join(" ")}<small>ordem ${i.ordem}${numeros.length ? ` · ${numeros.join(", ")}` : ""} · ${i.estacao} · ${i.largura}×${i.altura}</small><em>${esc(i.alt)}</em></figcaption>
</figure>`;
}

function main() {
  if (!fs.existsSync(PROCESSADAS)) throw new Error("galerias-processadas/ não existe. Rode `npm run galerias:preparar`.");
  const origens = fs.existsSync(path.join(PROCESSADAS, "_origem.json")) ? ler<Origem[]>(path.join(PROCESSADAS, "_origem.json")) : [];

  // Quase-duplicatas: a que ficou (no bucket) e as que saíram (cache local por SHA).
  const grupos = origens.filter((o) => new Set(o.origens.map((x) => x.sha)).size > 1);
  const blocosQuase = grupos.map((o) => {
    const fora = Array.from(new Set(o.origens.map((x) => x.sha))).filter((s) => s !== o.sha);
    const miniatura = (src: string, rotulo: string) =>
      `<figure><img loading="lazy" src="${esc(src)}"><figcaption><b class="${rotulo === "fica" ? "ok" : "x"}">${rotulo}</b></figcaption></figure>`;
    return `<div class="par"><p><code>${esc(o.arquivo)}</code> — chips: ${o.pastas.map(rotuloDaPasta).join(", ")}</p><div class="grade">${[
      miniatura(o.arquivo, "fica"),
      ...fora.map((s) => miniatura(`.cache/${s}.jpg`, "sai do site")),
    ].join("")}</div></div>`;
  });

  let total = 0;
  const secoes: string[] = [];
  for (const g of GRUPOS as readonly Grupo[]) {
    const itens = ler<ItemGaleria[]>(path.join(DIR, `${g}.json`)).sort((a, b) => a.ordem - b.ordem);
    total += itens.length;
    const pastas = ordenarPastas(itens.flatMap(pastasDoItem));
    const blocos = pastas.map((p) => {
      const lista = itens.filter((i) => pastasDoItem(i).includes(p));
      return `<h3>${esc(rotuloDaPasta(p))} <span>${lista.length} · pasta <code>${esc(p)}</code></span></h3><div class="grade">${lista.map((i) => card(i, g)).join("\n")}</div>`;
    });
    secoes.push(`<section><h2>${esc(g)} <span>${itens.length} fotos</span></h2>${blocos.join("\n")}</section>`);
  }

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Folha de contato — galerias</title>
<style>
  body{font:14px/1.4 system-ui,sans-serif;margin:0;padding:24px;background:#faf8f3;color:#1a1a1a}
  h1{margin:0 0 4px}h2{margin:40px 0 8px;border-bottom:2px solid #1a1a1a}h3{margin:24px 0 8px;color:#555}
  h2 span,h3 span{font-weight:normal;color:#888;font-size:.8em}
  .grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .par{background:#fff;border:1px solid #ddd;padding:8px;margin-bottom:12px}.par .grade{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  figure{margin:0;background:#fff;border:1px solid #ddd}figure.fora{opacity:.55;border-color:#c33}
  img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#E9E5E0}
  .par img{object-fit:contain;background:#222}
  figcaption{padding:8px;display:flex;flex-direction:column;gap:4px}code{font-size:11px;word-break:break-all}
  .chips i{display:inline-block;font-style:normal;background:#1a1a1a;color:#fff;padding:1px 6px;font-size:11px;margin:1px}
  b{font-weight:600;font-size:11px;padding:1px 6px;display:inline-block}b.x{background:#fde2e2;color:#a00}
  b.ok{background:#e0f2e6;color:#185}b.m{background:#fff3cd;color:#855}
  small{color:#888}em{font-size:12px;color:#444}
</style></head><body>
<h1>Folha de contato — galerias</h1>
<p>${total} fotos no site. <b>As pastas de <code>galerias-local/</code> decidem o chip.</b> Para mudar: mova o arquivo de pasta, tire para <code>_fora</code> ou numere o nome ("01 ") e peça ao Claude Code "atualize as galerias". Como fazer: topo do <code>DECISOES.md</code>.</p>
<section><h2>Quase-duplicatas <span>${grupos.length} grupos — fica uma, que herda as pastas de todas</span></h2>${blocosQuase.join("\n")}</section>
${secoes.join("\n")}
</body></html>`;
  fs.writeFileSync(SAIDA, html);
  console.log(`[folha] ${total} fotos, ${grupos.length} grupos de quase-duplicatas → ${path.relative(RAIZ, SAIDA)}`);
}

main();
