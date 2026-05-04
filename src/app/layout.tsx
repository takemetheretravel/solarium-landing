import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import FloatingWhatsApp from "@/components/ui/FloatingWhatsApp";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com";
const siteTitle = "Solarium Mantiqueira | Refúgio de Design na Serra";
const siteDescription =
  "Refúgio de design e experiência na Serra da Mantiqueira. Duas casas exclusivas, pensadas para casais que buscam imersão em natureza com tecnologia e conforto.";
const ogImage = `https://drive.google.com/thumbnail?id=1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8&sz=w1600`;

export const metadata: Metadata = {
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${serif.variable} ${sans.variable}`}>
      <body className="bg-cream text-charcoal">
        <Header />
        {children}
        <Footer />
        <FloatingWhatsApp />
      </body>
    </html>
  );
}
