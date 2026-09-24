import type { MetadataRoute } from "next";
import { SITE_URL, BLOQUEADOS_ROBOTS } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Fora de produção, nada é rastreável — o preview carrega preços de teste.
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: BLOQUEADOS_ROBOTS }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
