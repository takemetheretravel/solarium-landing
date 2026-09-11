/**
 * Gera `content/galerias/{casa}.json` a partir da Admin API do Cloudinary.
 *
 *   npm run galeria:sync
 *
 * Lê `solarium/casas/{casa}/**`, extrai `context.alt`, as tags de curadoria e
 * as dimensões reais, e escreve o manifesto que o site consome.
 *
 * IDEMPOTENTE em dois sentidos:
 *  - rodar duas vezes seguidas produz o mesmo arquivo, byte a byte;
 *  - o campo `ordem` já existente é PRESERVADO. Quem reordenou a galeria à mão
 *    no JSON não perde o trabalho no próximo sync; foto nova entra no fim.
 *
 * Solarium Completo agrega as três pastas de propósito — a reserva é das duas
 * casas, então a galeria dela é o acervo inteiro. Ver DECISOES.md.
 */
import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { AMBIENTES, ESTACOES } from "./curadoria-casas.mjs";

config({ path: ".env.local" });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const DESTINO = "content/galerias";

const CASAS = [
  { casa: "solarium-1", prefixos: ["solarium/casas/solarium-1"] },
  { casa: "solarium-2", prefixos: ["solarium/casas/solarium-2"] },
  {
    casa: "solarium-completo",
    prefixos: [
      "solarium/casas/solarium-completo",
      "solarium/casas/solarium-1",
      "solarium/casas/solarium-2",
    ],
  },
];

/** `solarium/casas/solarium-1/03-cafe-na-rede` → `solarium-1-03-cafe-na-rede`. */
function idDe(publicId) {
  return publicId.replace(/^solarium\/casas\//, "").replace(/\//g, "-");
}

function lerTag(tags, prefixo, aceitos) {
  const achada = (tags || [])
    .map((t) => (t.startsWith(`${prefixo}-`) ? t.slice(prefixo.length + 1) : null))
    .find((v) => v && aceitos.includes(v));
  return achada || null;
}

async function listarPrefixo(prefixo) {
  const todos = [];
  let cursor;
  do {
    const r = await cloudinary.api.resources({
      type: "upload",
      prefix: `${prefixo}/`,
      max_results: 500,
      context: true,
      tags: true,
      next_cursor: cursor,
    });
    todos.push(...r.resources);
    cursor = r.next_cursor;
  } while (cursor);
  return todos;
}

/**
 * Miniatura borrada em base64 para o `placeholder="blur"` do next/image.
 *
 * Vai embutida no manifesto, não como URL: 20px de largura com `q_1` dá poucas
 * centenas de bytes, e embutir troca uma requisição de rede por foto — que
 * chegaria DEPOIS do layout, que é exatamente quando o placeholder já não
 * serve para nada.
 */
async function blurEmBase64(publicId) {
  const url = cloudinary.url(publicId, {
    secure: true,
    transformation: [
      {
        effect: "blur:1000",
        quality: 1,
        width: 20,
        crop: "scale",
        fetch_format: "jpg",
        // `strip_profile` não é detalhe: sem ele o Cloudinary carrega o perfil
        // ICC do original junto e a miniatura de 20px sai com 3,4KB em vez de
        // 290 bytes — dez vezes o peso, em bytes que vão inteiros para o
        // payload da página.
        flags: "strip_profile",
      },
    ],
  });
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`blur ${resposta.status} em ${publicId}`);
  const bytes = Buffer.from(await resposta.arrayBuffer());
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

function manifestoExistente(caminho) {
  if (!existsSync(caminho)) return new Map();
  try {
    const json = JSON.parse(readFileSync(caminho, "utf8"));
    return new Map((json.fotos || []).map((f) => [f.id, f]));
  } catch {
    // Manifesto corrompido não pode travar a regeneração — é justamente o
    // arquivo que estamos reescrevendo.
    return new Map();
  }
}

async function gerarCasa({ casa, prefixos }) {
  const caminho = resolve(process.cwd(), DESTINO, `${casa}.json`);
  const anterior = manifestoExistente(caminho);

  const recursos = [];
  for (const [posicao, prefixo] of prefixos.entries()) {
    for (const r of await listarPrefixo(prefixo)) recursos.push({ ...r, __prefixo: posicao });
  }

  // Duplicata só acontece se um prefixo contiver outro; `id` é a chave natural.
  const porId = new Map();
  const problemas = [];

  for (const r of recursos) {
    const id = idDe(r.public_id);
    if (porId.has(id)) continue;

    const alt = r.context?.custom?.alt || r.context?.alt || "";
    const ambiente = lerTag(r.tags, "ambiente", AMBIENTES);
    const estacao = lerTag(r.tags, "estacao", ESTACOES) || "indiferente";

    if (!alt) problemas.push(`${r.public_id}: sem context.alt`);
    if (!ambiente) problemas.push(`${r.public_id}: sem tag ambiente-*`);
    if (!r.width || !r.height) problemas.push(`${r.public_id}: sem dimensões`);
    if (!alt || !ambiente || !r.width || !r.height) continue;

    const jaExistia = anterior.get(id);
    porId.set(id, {
      id,
      publicId: r.public_id,
      alt,
      ambiente,
      estacao,
      largura: r.width,
      altura: r.height,
      // `ordem` provisória: posição alfabética. O prefixo numérico dos arquivos
      // ("01-", "02-") já entrega a ordem pretendida na primeira geração.
      ordem: jaExistia?.ordem,
      destaque: (r.tags || []).includes("destaque"),
      blurDataURL: jaExistia?.blurDataURL,
      __prefixo: r.__prefixo,
    });
  }

  if (problemas.length > 0) {
    console.error(`✗ ${casa}: metadado faltando no Cloudinary`);
    for (const p of problemas) console.error(`    ${p}`);
    throw new Error(`${casa}: ${problemas.length} asset(s) sem metadado`);
  }

  // Ordem provisória: primeiro a pasta da própria casa, depois as agregadas, e
  // dentro de cada uma o prefixo numérico do arquivo ("01-", "02-"). Alfabética
  // pura jogaria as fotos do Solarium 1 na frente das do conjunto na página do
  // Completo, que é justamente o que aquela página não é.
  const fotos = [...porId.values()].sort(
    (a, b) => a.__prefixo - b.__prefixo || a.publicId.localeCompare(b.publicId, "pt-BR"),
  );
  for (const foto of fotos) delete foto.__prefixo;

  // Ordem preservada primeiro; quem ainda não tem recebe o próximo número livre.
  const usadas = new Set(fotos.map((f) => f.ordem).filter((o) => Number.isInteger(o)));
  let proxima = 1;
  for (const foto of fotos) {
    if (Number.isInteger(foto.ordem)) continue;
    while (usadas.has(proxima)) proxima++;
    foto.ordem = proxima;
    usadas.add(proxima);
  }
  fotos.sort((a, b) => a.ordem - b.ordem);

  for (const foto of fotos) {
    if (!foto.blurDataURL) foto.blurDataURL = await blurEmBase64(foto.publicId);
  }

  const conteudo = {
    casa,
    geradoPor: "npm run galeria:sync",
    fotos,
  };

  mkdirSync(resolve(process.cwd(), DESTINO), { recursive: true });
  writeFileSync(caminho, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
  const destaques = fotos.filter((f) => f.destaque).length;
  console.log(`✓ ${casa}: ${fotos.length} fotos (${destaques} em destaque) → ${DESTINO}/${casa}.json`);
  return fotos.length;
}

async function main() {
  const semCredencial = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    .filter((v) => !process.env[v]);
  if (semCredencial.length > 0) {
    console.error(`✗ Faltam credenciais no .env.local: ${semCredencial.join(", ")}`);
    process.exit(1);
  }

  for (const casa of CASAS) await gerarCasa(casa);
  console.log("\nManifestos atualizados. O schema em src/config/galeria.ts valida no build.");
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
