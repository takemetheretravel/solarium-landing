import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { ogImageUrl } from "@/lib/cloudinary";

/**
 * Peças comuns aos dois layouts raiz do App Router.
 *
 * Existem dois porque a rota de pagamento precisa ficar FORA do GTM de forma
 * estrutural: um layout que carrega o container e outro que não. Fonte,
 * metadata e classes do `<html>`/`<body>` são idênticas nos dois e moram aqui,
 * para não divergirem com o tempo.
 */

export const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

export const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com";

export const siteTitle = "Solarium Mantiqueira | Refúgio de Design na Serra";
export const siteDescription =
  "Refúgio de design e experiência na Serra da Mantiqueira. Duas casas exclusivas, pensadas para casais que buscam imersão em natureza com tecnologia e conforto.";
/**
 * og:image padrão do site — a mesma foto do hero da home, servida pelo
 * Cloudinary em 1200x630.
 *
 * Era um link do Google Drive. Drive não é CDN de imagem: responde com
 * redirecionamento, exige que o arquivo siga público para sempre, e vários
 * crawlers de rede social simplesmente não seguem esse redirect — o link
 * compartilhado saía sem imagem nenhuma.
 */
const ogImage = ogImageUrl("solarium/comum/hero-banheira-por-do-sol");

export const metadataBase: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: siteTitle, template: "%s | Solarium Mantiqueira" },
  description: siteDescription,
  keywords: ["Solarium Mantiqueira", "Serra da Mantiqueira", "hospedagem", "Itanhandu", "casa de temporada", "Take Me There"],
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: SITE_URL,
    siteName: "Solarium Mantiqueira",
    locale: "pt_BR",
    type: "website",
    images: [{ url: ogImage, width: 1200, height: 630, alt: "Solarium Mantiqueira" }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [ogImage],
  },
  robots: { index: true, follow: true },
};

export const classesHtml = `${serif.variable} ${sans.variable}`;
