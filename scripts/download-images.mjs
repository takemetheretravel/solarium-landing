// Download Drive images to /public.
// Suporta duas estratégias por item:
//   1) { fileId, savePath }                 — legacy: download via URL pública (sem auth)
//   2) { driveName, local, minSize? }       — busca por nome via Drive API com desambiguação por tamanho
//
// Entradas driveName requerem GOOGLE_SERVICE_ACCOUNT_JSON em .env.local e que a pasta
// 1BI06RVjQoL0_4aFQxFVrM2Xu-W263lwT esteja compartilhada com o e-mail do service account.
//
// Idempotente:
//  - fileId: pula se arquivo local existir
//  - driveName: pula se tamanho local == tamanho remoto; senão baixa de novo
import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync, statSync, createWriteStream, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { google } from "googleapis";
import { config } from "dotenv";
config({ path: ".env.local" });

const ROOT = resolve(process.cwd());
const FOLDER_ID = "1BI06RVjQoL0_4aFQxFVrM2Xu-W263lwT";

const IMAGES = [
  // LOGOS (fileId — não mudam)
  { fileId: "1IZbgrnYYsZi8Z_EUgUvcS8Ve16ZO777w", savePath: "public/images/comum/logo-preto.png" },
  { fileId: "1OV15NPns0IWYMPXZuyiOUEz7PUe5Dr8l", savePath: "public/images/comum/logo-branco.png" },
  { fileId: "1gA8QD3kvKfcYpKmDn4eOIFqIAGxs7YIx", savePath: "public/images/comum/logo-quadrado.png" },
  // HERO
  { fileId: "1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8", savePath: "public/images/comum/hero-banheira-por-do-sol.jpg" },
  // SOLARIUM 1
  { fileId: "1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8", savePath: "public/images/solarium-1/01-banheira-por-do-sol.jpg" },
  { fileId: "17W5LZJ8eLAEba49ZsGe1SK1b2t13r6Dy", savePath: "public/images/solarium-1/02-banheira-serra-fina.jpg" },
  { fileId: "1iCDdn8uREEmp5LHyMmhVqDgAkb-EtEao", savePath: "public/images/solarium-1/03-cafe-na-rede.jpg" },
  { fileId: "12T5h6YPz1FekcJ8DgxeoJRfVoLdsMCBk", savePath: "public/images/solarium-1/04-vista-traseira.jpg" },
  { fileId: "1Z4X1XXazEEfMAshKbcwnewTh4jqpL-JP", savePath: "public/images/solarium-1/05-banheira.jpg" },
  { fileId: "1GFb37d9ZP4wvF31UbuTzZoaAzL1QtH0i", savePath: "public/images/solarium-1/06-redario.jpg" },
  { fileId: "1Dsan8yfE0CCrWd1H082S2SgRhG6HIfbO", savePath: "public/images/solarium-1/07-nevoeiro-plantas.jpg" },
  { fileId: "1TwiWHWy_c0JL78C-K2EE1q5_RfAyYTi0", savePath: "public/images/solarium-1/08-fire-pit.jpg" },
  { fileId: "1GB-9iGmZ91eVpYyHorO1K6MSduJn9djN", savePath: "public/images/solarium-1/09-deck-por-do-sol.jpg" },
  { fileId: "1pvoYkpXzp3Yi3Ll-E7nmp-1SOCFLjKMd", savePath: "public/images/solarium-1/10-frente-rede-banheira.jpg" },
  // SOLARIUM 2
  { fileId: "1XZiLJItP4aC4A6rHZvEjiSahvc3g-yN3", savePath: "public/images/solarium-2/01-deck-serra-fina.jpg" },
  { fileId: "191sIkH7sYeooyP-Gyi-9RETR6HVwAXfy", savePath: "public/images/solarium-2/02-banheira-por-do-sol.jpg" },
  { fileId: "1AqotYVMMzKIDHxdQ3Br-l_0M7NpECU3Y", savePath: "public/images/solarium-2/03-frente-por-do-sol.jpg" },
  { fileId: "17D_HYSerOCXpPeA5Zj-MlYEV8e8UsjE2", savePath: "public/images/solarium-2/04-cinema-por-do-sol.jpg" },
  { fileId: "1vo02TebjcJMEemE-qeataUsP2Hb2syr_", savePath: "public/images/solarium-2/05-spa-teto-retratil.jpg" },
  { fileId: "1HidRA1fmmMeHj8kGZFl9mLRq5i0MEFIp", savePath: "public/images/solarium-2/06-spa-teto-retratil-2.jpg" },
  { fileId: "1YcFd3mmu5uoAt7iRuOTt4SU2HgiPgOMj", savePath: "public/images/solarium-2/07-quarto-por-do-sol.jpg" },
  { fileId: "1heOGdG2Wjnvo5xhEfqQH-p6RnHpUJ-JZ", savePath: "public/images/solarium-2/08-cinema-deck.jpg" },
  { fileId: "1mFvtNGtLA3pPq7dBijeK6H-F-x1IEGyo", savePath: "public/images/solarium-2/09-deck-tv.jpg" },
  { fileId: "1AXEISGXaorcWNBcSV1VCnoRkLv1ooeaB", savePath: "public/images/solarium-2/10-quarto-decorado.jpg" },
  // SOLARIUM COMPLETO
  { fileId: "1-Uu90NgdM46pp9wsQbHTXTG_x5gRawUX", savePath: "public/images/solarium-completo/01-frente-externa.jpg" },
  { fileId: "1d7joJITenVQK_yoIgeFAowU441VuU2nL", savePath: "public/images/solarium-completo/02-noite-com-lua.jpg" },
  { fileId: "1n55Z5DEk27v1lUVKIlnr8FxYuAPJNxUW", savePath: "public/images/solarium-completo/03-final-de-tarde.jpg" },
  { fileId: "1fRqaIpWbAf6BLmRRcryCR6QnEpJ4u54h", savePath: "public/images/solarium-completo/04-drone-serra-itatiaia.jpg" },
  { fileId: "1V4dG3DWLIOoCUfuNu13Iw23QE4Uu_ONM", savePath: "public/images/solarium-completo/05-drone-itatiaia.jpg" },
  { fileId: "1wDkVd1AOfckbf5iKyXC2-hKnrmJG74Gq", savePath: "public/images/solarium-completo/06-drone-serra-papagaio.jpg" },
  // EXPERIÊNCIAS (driveName — usuário troca foto no Drive, script detecta diff de tamanho e re-baixa)
  { driveName: "Exp_Cesta de Café preparada.jpg", local: "public/images/experiencias/cesta-cafe-preparada.jpg", minSize: 900000 },
  { driveName: "Exp_Cesta de Café.jpg",           local: "public/images/experiencias/cesta-cafe.jpg" },
  { driveName: "Exp_Sessão de Massagem.jpg",      local: "public/images/experiencias/massagem.jpg" },
  { driveName: "Exp_Passeio de Bike.jpg",         local: "public/images/experiencias/bike.jpg" },
  { driveName: "Exp_Passeio à Cavalo.jpg",        local: "public/images/experiencias/cavalo.jpg" },
  { driveName: "Exp_Decoração Romântica.jpg",     local: "public/images/experiencias/decoracao-romantica.jpg" },
  { driveName: "Exp_Cachoeira.jpg",               local: "public/images/experiencias/cachoeira.jpg" },
  { driveName: "Exp_Montanha.jpg",                local: "public/images/experiencias/montanha.jpg" },
  // Existem 2 "Exp_Queijaria.jpg" no Drive (5.2MB e 7.8MB). minSize garante que pegamos a maior/correta.
  { driveName: "Exp_Queijaria.jpg",               local: "public/images/experiencias/queijaria.jpg", minSize: 7000000 },
  { driveName: "Exp_Passeio de Trem.jpg",         local: "public/images/experiencias/maria-fumaca.jpg" },
  // VÍDEOS BRUTOS (legacy fileId)
  { fileId: "1D3UqHjnOPC12-lRo8_0q5yybteJ-ulsH", savePath: "temp/solarium-2-apresentacao.mp4" },
  { fileId: "1NosHtjV9u3OzfaSxVUD7lk-MnyntGbvq", savePath: "temp/massagem.mp4" },
  // VÍDEO HERO
  { fileId: "1BgEtofXRwedGOi1jwpSZV9zd7WOIbWPR", savePath: "public/videos/hero-banheira-nascer-sol.mp4" },
];

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

// ====================== fileId (legacy URL pública) ======================
async function fetchDriveFile(fileId) {
  const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let res = await fetch(baseUrl, { redirect: "follow" });
  let buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    const html = buf.toString("utf-8");
    const tokenMatch =
      html.match(/confirm=([0-9A-Za-z_-]+)/) ||
      html.match(/name="confirm"\s+value="([^"]+)"/) ||
      html.match(/"downloadUrl":"([^"]+)"/);
    if (tokenMatch) {
      const url = tokenMatch[0].startsWith("http")
        ? tokenMatch[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&")
        : `${baseUrl}&confirm=${tokenMatch[1]}`;
      res = await fetch(url, { redirect: "follow" });
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      const alt = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      res = await fetch(alt, { redirect: "follow" });
      buf = Buffer.from(await res.arrayBuffer());
    }
  }

  return { buf, status: res.status, contentType: res.headers.get("content-type") || "" };
}

async function processFileIdItem(item, summary) {
  const abs = resolve(ROOT, item.savePath);
  if (await fileExists(abs)) {
    console.log(`↷ skip  ${item.savePath} (já existe)`);
    summary.skipped++;
    return;
  }
  try {
    await mkdir(dirname(abs), { recursive: true });
    const { buf, status, contentType } = await fetchDriveFile(item.fileId);
    if (status !== 200 || buf.length < 1024 || contentType.includes("text/html")) {
      throw new Error(`HTTP ${status}, contentType=${contentType}, size=${buf.length}`);
    }
    await writeFile(abs, buf);
    console.log(`✓ ${item.savePath} (${fmtSize(buf.length)})`);
    summary.ok++;
  } catch (err) {
    console.error(`✗ ${item.savePath}: ${err.message}`);
    summary.failed.push({ path: item.savePath, fileId: item.fileId, error: err.message });
  }
}

// ====================== driveName (Drive API com auth) ======================
async function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON não encontrado em .env.local.\n" +
        "Adicione a chave de serviço Google com leitura no Drive.\n" +
        "Compartilhe a pasta do Drive com o e-mail do service account.",
    );
  }
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

async function findFileByName(drive, name, minSize = 0) {
  const res = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id, name, size, mimeType, modifiedTime)",
    pageSize: 10,
    orderBy: "modifiedTime desc",
  });
  const files = res.data.files || [];
  if (files.length === 0) throw new Error(`Não encontrado: ${name}`);

  if (minSize > 0) {
    const match = files.find((f) => parseInt(f.size || "0") >= minSize);
    if (match) return match;
    console.warn(`  ⚠ Nenhum arquivo "${name}" com tamanho >= ${minSize}. Usando o maior disponível.`);
    return files.sort((a, b) => parseInt(b.size || "0") - parseInt(a.size || "0"))[0];
  }
  return files[0];
}

async function downloadDriveStream(drive, fileId, localPath) {
  await mkdir(dirname(localPath), { recursive: true });
  const dest = createWriteStream(localPath);
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await new Promise((resolveDl, rejectDl) => {
    res.data.pipe(dest);
    res.data.on("error", rejectDl);
    dest.on("finish", resolveDl);
  });
}

async function processDriveNameItem(drive, item, summary) {
  const abs = resolve(ROOT, item.local);
  try {
    const file = await findFileByName(drive, item.driveName, item.minSize || 0);
    const driveSize = parseInt(file.size || "0");

    if (existsSync(abs)) {
      const localSize = statSync(abs).size;
      if (localSize === driveSize) {
        console.log(`↷ skip  ${item.local} (sem alterações)`);
        summary.skipped++;
        return;
      }
      console.log(`↻ alterado ${item.local} (local ${fmtSize(localSize)} → drive ${fmtSize(driveSize)})`);
      unlinkSync(abs);
    }

    console.log(`  Baixando ${item.driveName} (${fmtSize(driveSize)}) → ${item.local}...`);
    await downloadDriveStream(drive, file.id, abs);
    console.log(`✓ ${item.local} (${fmtSize(statSync(abs).size)})`);
    summary.ok++;
  } catch (err) {
    console.error(`✗ ${item.local}: ${err.message}`);
    summary.failed.push({ path: item.local, driveName: item.driveName, error: err.message });
  }
}

// ====================== main ======================
async function main() {
  const summary = { ok: 0, skipped: 0, failed: [] };

  const hasDriveNameEntries = IMAGES.some((i) => i.driveName);
  let drive = null;
  if (hasDriveNameEntries) {
    try {
      drive = await getDriveClient();
    } catch (err) {
      console.warn(`⚠ Drive API indisponível: ${err.message}`);
      console.warn("  → Entradas driveName serão puladas. Entradas fileId continuam funcionando.");
    }
  }

  for (const item of IMAGES) {
    if (item.fileId) {
      await processFileIdItem(item, summary);
    } else if (item.driveName) {
      if (!drive) {
        console.log(`↷ skip  ${item.local} (Drive API indisponível)`);
        summary.skipped++;
        continue;
      }
      await processDriveNameItem(drive, item, summary);
    }
  }

  console.log("\n———");
  console.log(`OK:      ${summary.ok}`);
  console.log(`Pulados: ${summary.skipped}`);
  console.log(`Falhas:  ${summary.failed.length}`);
  if (summary.failed.length) {
    console.log("\nFalhas detalhadas:");
    summary.failed.forEach((f) => console.log(`  - ${f.path}: ${f.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
