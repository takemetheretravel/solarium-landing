#!/usr/bin/env node
/**
 * Gera as imagens de compartilhamento (og:image / twitter:image), 1200x630,
 * a partir das fotos que o site já serve. Rodar de novo só se a foto-base mudar.
 * Na SEO-1c a origem passa a ser o Supabase (`comum/og/`).
 */
import sharp from "sharp";
import path from "path";

const BASES = {
  "solarium-mantiqueira": "public/images/comum/hero-banheira-por-do-sol.jpg",
  "solarium-1": "public/images/solarium-1/01-banheira-por-do-sol.jpg",
  "solarium-2": "public/images/solarium-2/01-deck-serra-fina.jpg",
  "solarium-completo": "public/images/solarium-completo/04-drone-serra-itatiaia.jpg",
};

for (const [nome, origem] of Object.entries(BASES)) {
  const destino = path.join("public/og", `${nome}.jpg`);
  await sharp(origem)
    .resize(1200, 630, { fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(destino);
  console.log(`[og] ${destino}`);
}
