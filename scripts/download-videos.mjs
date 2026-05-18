// Download Drive videos to /temp.
// Suporta dois modos por entrada:
//   1) { fileId, localPath } — URL pública do Drive (sem auth, recomendado)
//   2) { driveName, localPath } — busca por nome (requer GOOGLE_SERVICE_ACCOUNT_JSON)
// Auth só é necessária se houver entrada sem fileId.
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import https from "https";
import { mkdir } from "node:fs/promises";
import { config } from "dotenv";
config({ path: ".env.local" });

const FOLDER_ID = "1BI06RVjQoL0_4aFQxFVrM2Xu-W263lwT";

// Mapa: entrada do Drive → caminho local
const VIDEOS = [
  { driveName: "Vid_Solarium2_Apresentacao.mp4", localPath: "temp/solarium-2-apresentacao.mp4" },
  { driveName: "Vid_Solarium1_Apresentacao.mp4", localPath: "temp/solarium-1-apresentacao.mp4" },
  { fileId: "1ztXlF4goeWNZXOJYfYDdgkK-YW97YoM4", driveName: "Vid_Solarium Completo_Apresentacao.mp4", localPath: "temp/solarium-completo-apresentacao.mp4" },
];

async function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON não encontrado em .env.local.\n" +
        "Adicione o JSON da chave de serviço Google com acesso de leitura ao Drive.\n" +
        "A pasta do Drive deve ser compartilhada com o e-mail do service account.",
    );
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

async function findFileByName(drive, name) {
  // 1) Busca exata por título (com extensão)
  let res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name = '${name}' and trashed = false`,
    fields: "files(id, name, size, mimeType)",
    pageSize: 1,
  });
  let files = res.data.files || [];
  if (files.length > 0) return files[0];

  // 2) Busca exata SEM extensão, filtrando por mimeType video/*
  const nameWithoutExt = name.replace(/\.[^.]+$/, "");
  if (nameWithoutExt !== name) {
    res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and name = '${nameWithoutExt}' and mimeType contains 'video/' and trashed = false`,
      fields: "files(id, name, size, mimeType)",
      pageSize: 1,
    });
    files = res.data.files || [];
    if (files.length > 0) return files[0];
  }

  // 3) Fallback: busca por substring (com ou sem extensão)
  res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name contains '${nameWithoutExt}' and trashed = false`,
    fields: "files(id, name, size, mimeType)",
    pageSize: 5,
  });
  files = res.data.files || [];
  if (files.length === 0)
    throw new Error(`Arquivo não encontrado no Drive (com ou sem extensão): "${name}"`);
  return files[0];
}

async function downloadFile(drive, fileId, localPath) {
  await mkdir(path.dirname(localPath), { recursive: true });
  const dest = fs.createWriteStream(localPath);
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    res.data.pipe(dest);
    res.data.on("error", reject);
    dest.on("finish", resolve);
  });
}

async function downloadPublic(fileId, localPath) {
  await mkdir(path.dirname(localPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const dest = fs.createWriteStream(localPath);
    const get = (u, hops = 0) => {
      if (hops > 5) return reject(new Error("Too many redirects"));
      https
        .get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return get(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          res.pipe(dest);
          res.on("error", reject);
          dest.on("finish", resolve);
        })
        .on("error", reject);
    };
    get(url);
  });
}

function fmtSize(bytes) {
  if (!bytes) return "?MB";
  const n = Number(bytes);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

async function main() {
  // Auth só é necessária se alguma entrada NÃO tem fileId
  const needsAuth = VIDEOS.some((v) => !v.fileId);
  let drive = null;
  if (needsAuth) {
    try {
      const auth = await getAuthClient();
      drive = google.drive({ version: "v3", auth });
    } catch (err) {
      console.warn(`⚠ Drive API indisponível (${err.message}). Só vou processar entradas com fileId.`);
    }
  }

  const summary = { ok: 0, skipped: 0, failed: [] };

  for (const video of VIDEOS) {
    const exists = fs.existsSync(video.localPath) && fs.statSync(video.localPath).size > 1024;
    if (exists) {
      console.log(`↷ skip  ${video.localPath} (já existe)`);
      summary.skipped++;
      continue;
    }

    const label = video.driveName || video.fileId;
    try {
      if (video.fileId) {
        console.log(`Baixando via URL pública: ${label} (id=${video.fileId})`);
        await downloadPublic(video.fileId, video.localPath);
      } else {
        if (!drive) {
          throw new Error("Entrada sem fileId requer GOOGLE_SERVICE_ACCOUNT_JSON em .env.local");
        }
        console.log(`Buscando "${video.driveName}" no Drive...`);
        const file = await findFileByName(drive, video.driveName);
        console.log(`  Encontrado: ID ${file.id}, ${fmtSize(file.size)}`);
        await downloadFile(drive, file.id, video.localPath);
      }
      const size = fmtSize(fs.statSync(video.localPath).size);
      console.log(`  ✓ Download concluído → ${video.localPath} (${size})`);
      summary.ok++;
    } catch (err) {
      console.error(`  ✗ Erro: ${err.message}`);
      summary.failed.push({ name: label, error: err.message });
      if (fs.existsSync(video.localPath)) fs.unlinkSync(video.localPath);
    }
  }

  console.log("\n———");
  console.log(`OK:      ${summary.ok}`);
  console.log(`Pulados: ${summary.skipped}`);
  console.log(`Falhas:  ${summary.failed.length}`);
  if (summary.failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
