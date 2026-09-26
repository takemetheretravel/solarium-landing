#!/usr/bin/env tsx
/**
 * IMG-0 — sobe `galerias-processadas/` para o bucket público `galerias` do
 * Supabase Storage, no mesmo caminho relativo.
 *
 *   npm run galerias:subir -- --dry-run   só lista o que subiria (não precisa de credencial)
 *   npm run galerias:subir                sobe de verdade e confere 5 URLs públicas
 *
 * Credenciais em `.env.local`: NEXT_PUBLIC_SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY. A service role só existe neste script — nada em
 * `src/` a cita (há teste para isso). Fala com a API REST do Storage via
 * fetch, sem biblioteca.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const RAIZ = path.resolve(__dirname, "..");
const ORIGEM = path.join(RAIZ, "galerias-processadas");
const BUCKET = "galerias";
const CACHE_CONTROL = "31536000";
const PARALELO = 4;
const AMOSTRA_HEAD = 5;

/** Fora do upload: cópias para o Google, cache de conversão, material de revisão e a folha de contato. */
const FORA = /^(gmb|\.cache|_revisao)\/|^(_origem\.json|folha-contato\.html)$/;

const TIPOS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function listar(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [path.relative(ORIGEM, p).replace(/\\/g, "/")];
  });
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const seco = process.argv.includes("--dry-run");
  if (!fs.existsSync(ORIGEM)) throw new Error("galerias-processadas/ não existe. Rode `npm run galerias:preparar` antes.");

  const arquivos = listar(ORIGEM)
    .filter((r) => !FORA.test(r))
    .sort()
    .map((rel) => {
      const tipo = TIPOS[path.extname(rel).toLowerCase()];
      if (!tipo) throw new Error(`Tipo não suportado: ${rel}`);
      return { rel, tipo, bytes: fs.statSync(path.join(ORIGEM, rel)).size };
    });
  const total = arquivos.reduce((s, a) => s + a.bytes, 0);

  if (seco) {
    for (const a of arquivos) console.log(`[dry-run] ${a.rel}  (${a.tipo}, ${(a.bytes / 1024).toFixed(0)} KB)`);
    console.log(`[dry-run] ${arquivos.length} arquivos, ${mb(total)} → bucket "${BUCKET}" (nada foi enviado)`);
    return;
  }

  dotenv.config({ path: path.join(RAIZ, ".env.local"), quiet: true });
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const faltam = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !chave && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (faltam.length) throw new Error(`Faltam no .env.local: ${faltam.join(", ")}`);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL fora do formato https://<projeto>.supabase.co");
  }

  // API REST do Storage direto, com fetch: o @supabase/supabase-js exige
  // WebSocket nativo (Node 22+) só por causa do realtime, que o upload não usa.
  const caminhoUrl = (rel: string) => rel.split("/").map(encodeURIComponent).join("/");
  async function enviar(rel: string, corpo: Buffer, tipo: string): Promise<string | null> {
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminhoUrl(rel)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        apikey: chave,
        "Content-Type": tipo,
        "Cache-Control": `max-age=${CACHE_CONTROL}`,
        "x-upsert": "true",
      },
      body: new Uint8Array(corpo),
    });
    if (r.ok) return null;
    return `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  }

  let enviados = 0;
  let bytes = 0;
  const falhas: string[] = [];
  const fila = [...arquivos];

  async function trabalhador() {
    for (let a = fila.shift(); a; a = fila.shift()) {
      const corpo = fs.readFileSync(path.join(ORIGEM, a.rel));
      const erro = await enviar(a.rel, corpo, a.tipo);
      if (erro) {
        falhas.push(`${a.rel}: ${erro}`);
        continue;
      }
      enviados++;
      bytes += a.bytes;
      if (enviados % 20 === 0) console.log(`[subir] ${enviados}/${arquivos.length}`);
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));

  console.log(`[subir] enviados ${enviados}/${arquivos.length}, ${mb(bytes)} (${bytes} bytes)`);
  if (falhas.length) {
    console.error(`[subir] ${falhas.length} falha(s):\n  ${falhas.join("\n  ")}`);
    process.exitCode = 1;
  }

  // Conferência: 5 URLs públicas sorteadas precisam responder 200.
  const amostra = [...arquivos].sort(() => Math.random() - 0.5).slice(0, AMOSTRA_HEAD);
  let ok = 0;
  for (const a of amostra) {
    const publica = `${url}/storage/v1/object/public/${BUCKET}/${caminhoUrl(a.rel)}`;
    const r = await fetch(publica, { method: "HEAD" });
    const tipo = r.headers.get("content-type");
    console.log(`[HEAD] ${r.status} ${tipo ?? "-"}  ${publica}`);
    if (r.status === 200) ok++;
  }
  console.log(`[subir] conferência: ${ok}/${amostra.length} URLs públicas com 200`);
  if (ok !== amostra.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
