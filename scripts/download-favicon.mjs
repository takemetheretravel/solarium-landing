import https from 'https';
import fs from 'fs';

const fileId = '1gA8QD3kvKfcYpKmDn4eOIFqIAGxs7YIx';
const url = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
const dest = 'src/app/icon.png';

function download(u, hops = 0) {
  if (hops > 5) {
    console.error('Too many redirects');
    process.exit(1);
  }
  https
    .get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, hops + 1);
      }
      if (res.statusCode !== 200) {
        console.error(`HTTP ${res.statusCode}`);
        process.exit(1);
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(dest).size;
        console.log(`✓ favicon salvo em ${dest} (${(size / 1024).toFixed(1)} KB)`);
      });
    })
    .on('error', (e) => {
      console.error('Erro:', e.message);
      process.exit(1);
    });
}

download(url);
