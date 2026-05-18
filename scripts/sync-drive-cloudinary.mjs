import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';
import https from 'https';

config({ path: '.env.local' });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const MAPPING = [
  { fileId: '1pbF1V36-ht-ydqugHAEK6FquqiM8Cdln', publicId: 'solarium/experiencias/cesta-cafe-preparada', name: 'Cesta Café Preparada' },
  { fileId: '1OjIisa9i8ExpEZtA-t1K3WPTIDL2PyAO', publicId: 'solarium/experiencias/cesta-cafe',            name: 'Cesta Café' },
  { fileId: '1AndFJcz5BaRz5_FrdO98SG3g_wZ1gWBs', publicId: 'solarium/experiencias/massagem',             name: 'Massagem' },
  { fileId: '1Jaa_3D7eTPuz8Q0giBhpeizAoyF_CE87',  publicId: 'solarium/experiencias/bike',                name: 'Bike' },
  { fileId: '16KhoW6E8tcGo7vTCcHwC2r2SiA1zIQuc',  publicId: 'solarium/experiencias/cavalo',              name: 'Cavalo' },
  { fileId: '1bgXPR1JqBKcAoPdy5E1cGtTZUgT_qa2x',  publicId: 'solarium/experiencias/decoracao-romantica', name: 'Decoração Romântica' },
  { fileId: '1HC1FCgw117EQ_Q_V3GM550XCK33BIynv',  publicId: 'solarium/experiencias/cachoeira',           name: 'Cachoeira' },
  { fileId: '1A7D0793gybf1DrwBQY34rnDyPCvuNNoX',  publicId: 'solarium/experiencias/montanha',            name: 'Montanha' },
  { fileId: '1mWzdo8NgGqsDIny412SI3xPGSoFQABou',  publicId: 'solarium/experiencias/queijaria',           name: 'Queijaria' },
  { fileId: '1i_GZJiPQZtcwCqTb9tTCxfS0okLKrNsm',  publicId: 'solarium/experiencias/maria-fumaca',       name: 'Maria Fumaça' },
];

function downloadStream(fileId) {
  return new Promise((resolve, reject) => {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const get = (u, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(res);
      }).on('error', reject);
    };
    get(url);
  });
}

async function upload(fileId, publicId) {
  return new Promise(async (resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, invalidate: true, resource_type: 'image' },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    const res = await downloadStream(fileId);
    res.pipe(stream);
  });
}

async function main() {
  console.log('🔄 Sync Drive → Cloudinary\n');
  let ok = 0, fail = 0;
  for (const item of MAPPING) {
    process.stdout.write(`→ ${item.name} ... `);
    try {
      const r = await upload(item.fileId, item.publicId);
      console.log(`✓ v${r.version}`);
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${ok} OK, ${fail} falhas.`);
  if (ok > 0) console.log('Site atualiza em ~2 min.');
}

main().catch(console.error);
