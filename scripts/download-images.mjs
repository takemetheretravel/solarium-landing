// Download Drive images to /public.
// Idempotent: skips files already present. Handles Drive's HTML "download warning"
// page for large files by parsing the confirmation token and re-requesting.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(process.cwd());

const IMAGES = [
  // LOGOS
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

async function fetchDriveFile(fileId) {
  const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let res = await fetch(baseUrl, { redirect: "follow" });
  let buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";

  // Drive returns an HTML "download warning" for large files. Parse the confirmation token.
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
      // Try the alternate "usercontent" host
      const alt = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      res = await fetch(alt, { redirect: "follow" });
      buf = Buffer.from(await res.arrayBuffer());
    }
  }

  return { buf, status: res.status, contentType: res.headers.get("content-type") || "" };
}

async function main() {
  const summary = { ok: 0, skipped: 0, failed: [] };
  for (const item of IMAGES) {
    const abs = resolve(ROOT, item.savePath);
    if (await fileExists(abs)) {
      console.log(`↷ skip  ${item.savePath} (já existe)`);
      summary.skipped++;
      continue;
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

  console.log("\n———");
  console.log(`OK:      ${summary.ok}`);
  console.log(`Pulados: ${summary.skipped}`);
  console.log(`Falhas:  ${summary.failed.length}`);
  if (summary.failed.length) {
    console.log("\nFalhas detalhadas:");
    summary.failed.forEach((f) => console.log(`  - ${f.path} (${f.fileId}): ${f.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
