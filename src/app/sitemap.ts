import type { MetadataRoute } from "next";
import { PROPERTIES } from "@/config/properties";
import { pacotesV2Ativo } from "@/config/flags";
import { pacotesVisiveis } from "@/lib/pricing/elegibilidade";
import { SITE_URL } from "@/lib/seo";

// Pacote sazonal entra e sai do sitemap sem depender de deploy.
export const revalidate = 86400;

/**
 * Rotas públicas indexáveis. Reserva, pagamento, confirmação, admin e API
 * ficam de fora (e bloqueadas no robots). Imagens entram na SEO-1c, quando a
 * origem passar a ser o manifesto de galerias.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const url = (caminho: string) => (caminho === "/" ? SITE_URL : `${SITE_URL}${caminho}`);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/experiencias"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: url("/ofertas"), lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: url("/parceiros"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: url("/termos"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/privacidade"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const propertyRoutes: MetadataRoute.Sitemap = PROPERTIES.map((p) => ({
    url: url(`/${p.slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  // /pacotes só existe com a flag ligada (senão responde 404).
  const hoje = now.toISOString().slice(0, 10);
  const pacoteRoutes: MetadataRoute.Sitemap = pacotesV2Ativo()
    ? [
        { url: url("/pacotes"), lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 },
        ...pacotesVisiveis(hoje).map((slug) => ({
          url: url(`/pacotes/${slug}`),
          lastModified: now,
          changeFrequency: "weekly" as const,
          priority: 0.7,
        })),
      ]
    : [];

  return [...staticRoutes, ...propertyRoutes, ...pacoteRoutes];
}
