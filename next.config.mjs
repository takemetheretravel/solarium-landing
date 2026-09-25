// Fotos do site: bucket público `galerias` do Supabase Storage (IMG-0/IMG-1).
// Sem a variável o build falha aqui, com mensagem clara, em vez de publicar um
// site com todas as fotos quebradas.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL não definida: cadastre na Vercel (Production e Preview) e no .env.local.");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: new URL(SUPABASE_URL).hostname,
        pathname: "/storage/v1/object/public/galerias/**",
      },
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "lh6.googleusercontent.com" },
      { protocol: "https", hostname: "hostaway-platform.s3.us-west-2.amazonaws.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
  async redirects() {
    return [
      // O pacote foi renomeado para cobrir Natal e Ano Novo, nao so a virada.
      { source: "/pacotes/virada-na-serra", destination: "/pacotes/final-de-ano", permanent: true },
    ];
  },

  async headers() {
    // Preview nunca é indexado: os preços de teste não podem aparecer em busca.
    const naoIndexar =
      process.env.VERCEL_ENV !== "production"
        ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
        : [];

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...naoIndexar,
        ],
      },
    ];
  },
};

export default nextConfig;
