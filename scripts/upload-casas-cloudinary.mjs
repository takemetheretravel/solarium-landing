/**
 * Sobe as fotos das casas para o Cloudinary em `solarium/casas/{casa}/**`,
 * carimbando `context.alt` e as tags de curadoria em cada asset.
 *
 * Roda uma vez para migrar os JPGs de `public/images/` e depois só quando
 * entrar foto nova. Idempotente: `overwrite` + `invalidate`, e o mesmo
 * `public_id` derivado do nome do arquivo.
 *
 *   npm run upload:casas   →   npm run galeria:sync
 *
 * Fluxo completo e o porquê da separação em dois comandos: DECISOES.md.
 */
import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
import { CURADORIA, AMBIENTES, ESTACOES } from "./curadoria-casas.mjs";

config({ path: ".env.local" });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** Origem local → pasta no Cloudinary. `comum` guarda só o hero da home. */
const GRUPOS = [
  { dir: "public/images/solarium-1", casa: "solarium-1", destino: "solarium/casas/solarium-1" },
  { dir: "public/images/solarium-2", casa: "solarium-2", destino: "solarium/casas/solarium-2" },
  {
    dir: "public/images/solarium-completo",
    casa: "solarium-completo",
    destino: "solarium/casas/solarium-completo",
  },
  { dir: "public/images/comum", casa: "comum", destino: "solarium/comum", somente: /^hero-/ },
];

const MAX_BYTES = 9.5 * 1024 * 1024;

async function prepararBuffer(caminho) {
  if (statSync(caminho).size <= MAX_BYTES) {
    return { buffer: readFileSync(caminho), compactado: false };
  }
  let qualidade = 85;
  let buffer;
  while (qualidade >= 50) {
    buffer = await sharp(caminho)
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: qualidade, mozjpeg: true })
      .toBuffer();
    if (buffer.length <= MAX_BYTES) break;
    qualidade -= 10;
  }
  return { buffer, compactado: true, qualidade };
}

/**
 * Tags sem dois-pontos: `ambiente-vista`, não `ambiente:vista`. Dois-pontos
 * em tag do Cloudinary atravessa URL de listagem e vira dor de cabeça na
 * Admin API — o hífen custa nada e não tem essa aresta.
 */
function tagsDe(curadoria) {
  const tags = [`ambiente-${curadoria.ambiente}`, `estacao-${curadoria.estacao || "indiferente"}`];
  if (curadoria.destaque) tags.push("destaque");
  return tags;
}

function enviar(buffer, publicId, curadoria) {
  return new Promise((ok, falhou) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
        context: { alt: curadoria.alt },
        tags: tagsDe(curadoria),
      },
      (err, resultado) => (err ? falhou(err) : ok(resultado)),
    );
    stream.end(buffer);
  });
}

async function main() {
  const semCredencial = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    .filter((v) => !process.env[v]);
  if (semCredencial.length > 0) {
    console.error(`✗ Faltam credenciais no .env.local: ${semCredencial.join(", ")}`);
    process.exit(1);
  }

  const resumo = { ok: 0, falhas: [], semCuradoria: [] };

  for (const grupo of GRUPOS) {
    const dir = resolve(process.cwd(), grupo.dir);
    if (!existsSync(dir)) {
      console.log(`⚠ ${grupo.dir} não existe — provavelmente já migrado. Pulando.`);
      continue;
    }
    const arquivos = readdirSync(dir)
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .filter((f) => (grupo.somente ? grupo.somente.test(f) : true));

    for (const arquivo of arquivos) {
      const base = arquivo.replace(/\.[^.]+$/, "");
      const chave = `${grupo.casa}/${base}`;
      const curadoria = CURADORIA[chave];

      // Sem curadoria não sobe: um asset sem alt entra no manifesto sem texto
      // alternativo e o schema derruba o build lá na frente. Falhar aqui é
      // mais barato e diz exatamente qual foto falta descrever.
      if (!curadoria) {
        console.error(`  ✗ sem curadoria para "${chave}" — adicione em scripts/curadoria-casas.mjs`);
        resumo.semCuradoria.push(chave);
        continue;
      }
      if (!AMBIENTES.includes(curadoria.ambiente)) {
        console.error(`  ✗ ambiente inválido em "${chave}": ${curadoria.ambiente}`);
        resumo.falhas.push(chave);
        continue;
      }
      if (curadoria.estacao && !ESTACOES.includes(curadoria.estacao)) {
        console.error(`  ✗ estacao inválida em "${chave}": ${curadoria.estacao}`);
        resumo.falhas.push(chave);
        continue;
      }

      const publicId = `${grupo.destino}/${base}`;
      try {
        const { buffer, compactado, qualidade } = await prepararBuffer(resolve(dir, arquivo));
        const mb = (buffer.length / 1024 / 1024).toFixed(1);
        console.log(
          `↑ ${chave} → ${publicId} (${compactado ? `compactado q=${qualidade}, ` : ""}${mb}MB)`,
        );
        const r = await enviar(buffer, publicId, curadoria);
        console.log(`  ✓ ${r.width}x${r.height}`);
        resumo.ok++;
      } catch (err) {
        console.error(`  ✗ ${chave}: ${err.message}`);
        resumo.falhas.push(chave);
      }
    }
  }

  console.log("\n———");
  console.log(`Enviadas:      ${resumo.ok}`);
  console.log(`Sem curadoria: ${resumo.semCuradoria.length}`);
  console.log(`Falhas:        ${resumo.falhas.length}`);
  if (resumo.falhas.length > 0 || resumo.semCuradoria.length > 0) process.exit(1);
  console.log("\nPróximo passo: npm run galeria:sync");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
