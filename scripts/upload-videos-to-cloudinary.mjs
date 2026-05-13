import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

config({ path: ".env.local" });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const uploads = [
  {
    file: "temp/solarium-2-apresentacao.mp4",
    publicId: "solarium/solarium-2-apresentacao",
  },
  {
    file: "temp/massagem.mp4",
    publicId: "solarium/exp-massagem",
  },
];

async function main() {
  for (const item of uploads) {
    const fullPath = resolve(process.cwd(), item.file);
    if (!existsSync(fullPath)) {
      console.log(`⚠ Arquivo não encontrado: ${item.file} — skip`);
      continue;
    }
    console.log(`Uploading ${item.file} → ${item.publicId}...`);
    try {
      try {
        await cloudinary.api.resource(item.publicId, { resource_type: "video" });
        console.log(`✓ Já existe: ${item.publicId}`);
        continue;
      } catch {
        // Não existe, faz upload
      }

      const result = await cloudinary.uploader.upload(fullPath, {
        resource_type: "video",
        public_id: item.publicId,
        overwrite: false,
        eager: [
          { quality: "auto", format: "mp4" },
          { quality: "auto", format: "webm" },
        ],
        eager_async: true,
      });
      console.log(`✓ Upload concluído: ${result.secure_url}`);
    } catch (err) {
      console.error(`✗ Erro em ${item.file}:`, err.message);
    }
  }
}

main().catch(console.error);
