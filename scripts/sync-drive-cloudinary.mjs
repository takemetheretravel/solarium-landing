// Pipeline DIRETO: Drive → Cloudinary (sem armazenamento local intermediário).
// Requer GOOGLE_SERVICE_ACCOUNT_JSON em .env.local + pasta do Drive compartilhada com o service account.
// Imagens >10MB são comprimidas via sharp antes do upload ao Cloudinary (limite free tier).
//
// Protocolo de atualização:
//   1) Trocar foto no Drive (mantendo o mesmo nome)
//   2) npm run sync:images
//   3) Aguardar 1-2 min para CDN propagar
//   → Site atualiza automaticamente, SEM commit, SEM deploy.
import { google } from "googleapis";
import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import sharp from "sharp";

config({ path: ".env.local" });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const FOLDER_ID = "1BI06RVjQoL0_4aFQxFVrM2Xu-W263lwT";
const MAX_BYTES = 9.5 * 1024 * 1024; // 9.5MB threshold (Cloudinary free = 10MB)

// Mapa: nome no Drive → public_id Cloudinary
const MAPPING = [
  { driveName: "Exp_Cesta de Café preparada.jpg", publicId: "solarium/experiencias/cesta-cafe-preparada" },
  { driveName: "Exp_Cesta de Café.jpg", publicId: "solarium/experiencias/cesta-cafe" },
  { driveName: "Exp_Sessão de Massagem.jpg", publicId: "solarium/experiencias/massagem" },
  { driveName: "Exp_Passeio de Bike.jpg", publicId: "solarium/experiencias/bike" },
  { driveName: "Exp_Passeio à Cavalo.jpg", publicId: "solarium/experiencias/cavalo" },
  { driveName: "Exp_Decoração Romântica.jpg", publicId: "solarium/experiencias/decoracao-romantica" },
  { driveName: "Exp_Cachoeira.jpg", publicId: "solarium/experiencias/cachoeira" },
  { driveName: "Exp_Montanha.jpg", publicId: "solarium/experiencias/montanha" },
  // Existem 2 "Exp_Queijaria.jpg" no Drive (5.2MB e 7.8MB) — preferLarger pega o maior
  { driveName: "Exp_Queijaria.jpg", publicId: "solarium/experiencias/queijaria", preferLarger: true },
  { driveName: "Exp_Passeio de Trem.jpg", publicId: "solarium/experiencias/maria-fumaca" },
];

async function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON não encontrado em .env.local.\n" +
        "Adicione o JSON da chave de serviço Google com leitura no Drive.\n" +
        "A pasta do Drive deve ser compartilhada com o e-mail do service account.",
    );
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function findInDrive(drive, name, preferLarger = false) {
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id, name, size, modifiedTime, mimeType)",
    pageSize: 10,
    orderBy: preferLarger ? undefined : "modifiedTime desc",
  });
  const files = res.data.files || [];
  if (files.length === 0) return null;
  if (preferLarger) {
    return files.sort((a, b) => parseInt(b.size || "0") - parseInt(a.size || "0"))[0];
  }
  return files[0];
}

async function streamDriveToBuffer(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  const chunks = [];
  return new Promise((resolve, reject) => {
    res.data.on("data", (chunk) => chunks.push(chunk));
    res.data.on("end", () => resolve(Buffer.concat(chunks)));
    res.data.on("error", reject);
  });
}

async function compressIfNeeded(buffer) {
  if (buffer.length <= MAX_BYTES) return { buffer, compressed: false };
  let quality = 85;
  let result;
  while (quality >= 50) {
    result = await sharp(buffer)
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (result.length <= MAX_BYTES) break;
    quality -= 10;
  }
  return { buffer: result, compressed: true, quality };
}

async function uploadBufferToCloudinary(buffer, publicId) {
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

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

async function main() {
  let auth;
  try {
    auth = await getAuthClient();
  } catch (err) {
    console.error(`✗ Autenticação Drive: ${err.message}`);
    process.exit(1);
  }

  const drive = google.drive({ version: "v3", auth });
  const summary = { ok: 0, failed: [], notFound: [] };

  for (const item of MAPPING) {
    console.log(`\nSync: ${item.driveName} → ${item.publicId}`);
    try {
      const driveFile = await findInDrive(drive, item.driveName, item.preferLarger);
      if (!driveFile) {
        console.log(`  ✗ Não encontrado no Drive`);
        summary.notFound.push(item.driveName);
        continue;
      }
      console.log(
        `  📥 Drive: ${driveFile.id} (${fmtSize(parseInt(driveFile.size || "0"))}, modificado ${driveFile.modifiedTime})`,
      );

      const rawBuffer = await streamDriveToBuffer(drive, driveFile.id);
      const { buffer, compressed, quality } = await compressIfNeeded(rawBuffer);
      if (compressed) {
        console.log(`  🗜  Comprimido: ${fmtSize(rawBuffer.length)} → ${fmtSize(buffer.length)} (q=${quality})`);
      }

      const result = await uploadBufferToCloudinary(buffer, item.publicId);
      console.log(`  ☁  Cloudinary version: v${result.version}`);
      console.log(`  ✓ ${result.secure_url}`);
      summary.ok++;
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      summary.failed.push({ name: item.driveName, error: err.message });
    }
  }

  console.log("\n———");
  console.log(`OK:           ${summary.ok}`);
  console.log(`Não achados:  ${summary.notFound.length}`);
  console.log(`Falhas:       ${summary.failed.length}`);
  if (summary.notFound.length) {
    console.log("\nNão encontrados:");
    summary.notFound.forEach((n) => console.log(`  - "${n}"`));
  }
  if (summary.failed.length) {
    console.log("\nFalhas:");
    summary.failed.forEach((f) => console.log(`  - "${f.name}": ${f.error}`));
    process.exit(1);
  }
  console.log("\n✅ Sync concluído. CDN do Cloudinary invalidado.");
  console.log("💡 Aguarde 1-2 minutos para CDN propagar globalmente.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
