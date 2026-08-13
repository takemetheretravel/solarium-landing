import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com";

  // Fora de produção, nada é rastreável — o preview carrega preços de teste.
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/reservar", "/api", "/debug"] },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
