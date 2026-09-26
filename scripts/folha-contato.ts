#!/usr/bin/env tsx
/**
 * Folha de contato local para escolher inclusões manuais
 * (`content/galerias/ajustes-manuais.json`).
 *
 *   npm run galerias:folha  →  galerias-processadas/folha-contato.html
 *
 * Mostra as 165 fotos agrupadas por casa e ambiente, com caminho, chips em
 * que aparecem no site, exclusão (e motivo), marca d'água e tela. As
 * miniaturas são os arquivos locais de `galerias-processadas/` — a folha fica
 * fora do git e funciona offline.
 */
import fs from "fs";
import path from "path";

// A biblioteca do site exige a URL; a folha não a usa (miniaturas locais).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://local.invalid";

import { AJUSTES, CATEGORIAS, chipsDoItem, podeAparecer, podeSerVitrine } from "../src/lib/galerias";
import { GRUPOS, type Grupo, type ItemGaleria } from "../src/lib/galerias/manifesto";

const RAIZ = path.resolve(__dirname, "..");
const PROCESSADAS = path.join(RAIZ, "galerias-processadas");
const DIR = path.join(RAIZ, "content", "galerias");
const SAIDA = path.join(PROCESSADAS, "folha-contato.html");

type Curadoria = Record<string, { motivoExclusao?: string }>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ler = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8"));

function main() {
  if (!fs.existsSync(PROCESSADAS)) throw new Error("galerias-processadas/ não existe. Rode `npm run galerias:preparar`.");

  // Motivo de exclusão: o manifesto não tem o SHA; o mapa local do preparo tem.
  const curadoria = ler<Curadoria>(path.join(DIR, "curadoria.json"));
  const origem = fs.existsSync(path.join(PROCESSADAS, "_origem.json"))
    ? ler<{ arquivo: string; sha?: string }[]>(path.join(PROCESSADAS, "_origem.json"))
    : [];
  const shaDe = new Map(origem.map((o) => [o.arquivo, o.sha]));
  const rotulo = new Map(CATEGORIAS.map((c) => [c.id, c.rotulo]));

  let total = 0;
  const secoes: string[] = [];
  for (const g of GRUPOS as readonly Grupo[]) {
    const itens = ler<ItemGaleria[]>(path.join(DIR, `${g}.json`)).sort((a, b) => a.ordem - b.ordem);
    const porAmbiente = new Map<string, ItemGaleria[]>();
    for (const i of itens) porAmbiente.set(i.ambiente, [...(porAmbiente.get(i.ambiente) ?? []), i]);

    const blocos = Array.from(porAmbiente).map(([amb, lista]) => {
      const cards = lista.map((i) => {
        total++;
        const ajuste = AJUSTES[i.arquivo];
        const efetivo = { ...i, excluirDoSite: ajuste?.excluir ? true : ajuste?.incluir ? false : i.excluirDoSite };
        const aparece = podeAparecer(efetivo);
        const chips = aparece && ["solarium-1", "solarium-2"].includes(g) ? chipsDoItem(efetivo).map((c) => rotulo.get(c) ?? c) : [];
        const motivo = i.excluirDoSite ? curadoria[shaDe.get(i.arquivo) ?? ""]?.motivoExclusao ?? "sem motivo registrado" : "";
        const selos = [
          !aparece && `<b class="x">fora do site${motivo ? `: ${esc(motivo)}` : ""}</b>`,
          ajuste?.incluir && `<b class="ok">incluída manualmente</b>`,
          ajuste?.excluir && `<b class="x">excluída manualmente</b>`,
          ajuste?.ambientes && `<b class="aj">chips manuais</b>`,
          i.destaque && `<b class="ok">capa</b>`,
          i.marcaDagua && `<b class="m">marca d'água</b>`,
          i.telaComConteudo && `<b class="m">tela com conteúdo</b>`,
          i.baixaResolucao && `<b class="m">baixa resolução</b>`,
          i.creditoPendente && `<b class="m">crédito pendente${i.credito ? `: ${esc(i.credito)}` : ""}</b>`,
          aparece && !podeSerVitrine(efetivo) && `<b class="m">não pode ser vitrine</b>`,
        ].filter(Boolean);
        return `<figure class="${aparece ? "" : "fora"}">
  <a href="${esc(i.arquivo)}" target="_blank"><img loading="lazy" src="${esc(i.arquivo)}" alt="${esc(i.alt)}"></a>
  <figcaption><code>${esc(i.arquivo)}</code>
  <span class="chips">${chips.length ? chips.map((c) => `<i>${esc(c)}</i>`).join(" ") : g === "solarium-1" || g === "solarium-2" ? "<i class='nenhum'>nenhum chip</i>" : ""}</span>
  ${selos.join(" ")}<small>ordem ${i.ordem} · ${i.estacao} · ${i.largura}×${i.altura}</small><em>${esc(i.alt)}</em></figcaption>
</figure>`;
      });
      return `<h3>${esc(amb)} <span>${lista.length}</span></h3><div class="grade">${cards.join("\n")}</div>`;
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
  figure{margin:0;background:#fff;border:1px solid #ddd}figure.fora{opacity:.55;border-color:#c33}
  img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#E9E5E0}
  figcaption{padding:8px;display:flex;flex-direction:column;gap:4px}code{font-size:11px;word-break:break-all}
  .chips i{display:inline-block;font-style:normal;background:#1a1a1a;color:#fff;padding:1px 6px;font-size:11px;margin:1px}
  .chips i.nenhum{background:#c33}
  b{font-weight:600;font-size:11px;padding:1px 6px;display:inline-block}b.x{background:#fde2e2;color:#a00}
  b.ok{background:#e0f2e6;color:#185}b.m{background:#fff3cd;color:#855}b.aj{background:#e3ecff;color:#236}
  small{color:#888}em{font-size:12px;color:#444}
</style></head><body>
<h1>Folha de contato — galerias</h1>
<p>${total} fotos. Chips = onde a foto aparece em /solarium-1 e /solarium-2. Para mudar: <code>content/galerias/ajustes-manuais.json</code> (formato no topo do DECISOES.md).</p>
${secoes.join("\n")}
</body></html>`;
  fs.writeFileSync(SAIDA, html);
  console.log(`[folha] ${total} fotos → ${path.relative(RAIZ, SAIDA)}`);
}

main();
