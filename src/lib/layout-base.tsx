import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";

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

const siteTitle = "Solarium Mantiqueira | Refúgio de Design na Serra";
const siteDescription =
  "Refúgio de design e experiência na Serra da Mantiqueira. Duas casas exclusivas, pensadas para casais que buscam imersão em natureza com tecnologia e conforto.";
const ogImage = `https://drive.google.com/thumbnail?id=1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8&sz=w1600`;

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
    images: [{ url: ogImage, width: 1600, height: 900, alt: "Solarium Mantiqueira" }],
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
