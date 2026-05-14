// Download Drive videos to /temp by name.
// Requires GOOGLE_SERVICE_ACCOUNT_JSON in .env.local (JSON string of service account key).
// The Drive folder must be shared with the service account email.
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { mkdir } from "node:fs/promises";
import { config } from "dotenv";
config({ path: ".env.local" });

const FOLDER_ID = "1BI06RVjQoL0_4aFQxFVrM2Xu-W263lwT";

// Mapa: nome no Drive → caminho local
const VIDEOS = [
  { driveName: "Vid_Solarium2_Apresentacao.mp4", localPath: "temp/solarium-2-apresentacao.mp4" },
  { driveName: "Vid_Solarium1_Apresentacao", localPath: "temp/solarium-1-apresentacao.mp4" },
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
  // Primeiro: busca exata por título
  let res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name = '${name}' and trashed = false`,
    fields: "files(id, name, size)",
    pageSize: 1,
  });
  let files = res.data.files || [];
  if (files.length > 0) return files[0];

  // Fallback: busca por substring (caso título não tenha extensão exata)
  res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name contains '${name}' and trashed = false`,
    fields: "files(id, name, size)",
    pageSize: 5,
  });
  files = res.data.files || [];
  if (files.length === 0) throw new Error(`Arquivo não encontrado no Drive: "${name}"`);
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

function fmtSize(bytes) {
  if (!bytes) return "?MB";
  const n = Number(bytes);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

async function main() {
  let auth;
  try {
    auth = await getAuthClient();
  } catch (err) {
    console.error(`✗ Autenticação: ${err.message}`);
    process.exit(1);
  }

  const drive = google.drive({ version: "v3", auth });
  const summary = { ok: 0, skipped: 0, failed: [] };

  for (const video of VIDEOS) {
    const exists = fs.existsSync(video.localPath) && fs.statSync(video.localPath).size > 1024;
    if (exists) {
      console.log(`↷ skip  ${video.localPath} (já existe)`);
      summary.skipped++;
      continue;
    }
    console.log(`Buscando "${video.driveName}" no Drive...`);
    try {
      const file = await findFileByName(drive, video.driveName);
      console.log(`  Encontrado: ID ${file.id}, ${fmtSize(file.size)}`);
      console.log(`  Baixando para ${video.localPath}...`);
      await downloadFile(drive, file.id, video.localPath);
      const size = fmtSize(fs.statSync(video.localPath).size);
      console.log(`  ✓ Download concluído (${size})`);
      summary.ok++;
    } catch (err) {
      console.error(`  ✗ Erro: ${err.message}`);
      summary.failed.push({ name: video.driveName, error: err.message });
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
