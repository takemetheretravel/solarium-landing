// Upload images in public/images/experiencias/ to Cloudinary.
// Idempotent: usa overwrite=true + invalidate=true para sempre refletir o arquivo local.
// Arquivos > 9.5MB são compactados via sharp antes do upload (limite free Cloudinary = 10MB).
// Quando trocar foto no Drive → npm run download:images → npm run upload:images → site atualiza sozinho.
import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";

config({ path: ".env.local" });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const SOURCE_DIR = "public/images/experiencias";
const CLOUDINARY_FOLDER = "solarium/experiencias";
const MAX_BYTES = 9.5 * 1024 * 1024; // 9.5MB safety threshold below Cloudinary's 10MB free limit

async function prepareBuffer(fullPath) {
  const size = statSync(fullPath).size;
  if (size <= MAX_BYTES) {
    return { buffer: readFileSync(fullPath), compressed: false };
  }
  // Comprime mantendo dimensões grandes (max 2400px lado maior) com qualidade ajustada
  let quality = 85;
  let buffer;
  while (quality >= 50) {
    buffer = await sharp(fullPath)
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (buffer.length <= MAX_BYTES) break;
    quality -= 10;
  }
  return { buffer, compressed: true, quality };
}

async function uploadBuffer(buffer, publicId) {
  return new Promise((resolveUpload, rejectUpload) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
      },
      (err, result) => {
        if (err) rejectUpload(err);
        else resolveUpload(result);
      },
    );
    stream.end(buffer);
  });
}

async function main() {
  const sourceDir = resolve(process.cwd(), SOURCE_DIR);
  if (!existsSync(sourceDir)) {
    console.error(`✗ Diretório não encontrado: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(sourceDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (files.length === 0) {
    console.log("⚠ Nenhuma imagem encontrada em " + SOURCE_DIR);
    return;
  }

  const summary = { ok: 0, failed: [] };
  for (const file of files) {
    const fullPath = resolve(sourceDir, file);
    const baseName = file.replace(/\.[^.]+$/, "");
    const publicId = `${CLOUDINARY_FOLDER}/${baseName}`;
    try {
      const { buffer, compressed, quality } = await prepareBuffer(fullPath);
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
      const tag = compressed ? `compactado q=${quality}, ${sizeMB}MB` : `${sizeMB}MB`;
      console.log(`Uploading ${file} → ${publicId} (${tag})...`);
      const result = await uploadBuffer(buffer, publicId);
      console.log(`  ✓ ${result.secure_url}`);
      summary.ok++;
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      summary.failed.push({ file, error: err.message });
    }
  }

  console.log("\n———");
  console.log(`OK:     ${summary.ok}`);
  console.log(`Falhas: ${summary.failed.length}`);
  if (summary.failed.length > 0) process.exit(1);
}

main().catch(console.error);
