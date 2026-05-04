import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com";
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/reservar", "/api", "/debug"] },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
