import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import Script from "next/script";
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
        <Script
          id="ga4"
          strategy="afterInteractive"
          src="https://www.googletagmanager.com/gtag/js?id=G-9J8F6Q1Y2M"
        />
        <Script id="ga4-init" strategy="afterInteractive">{`
          window.dataLayer=window.dataLayer||[];
          function gtag(){dataLayer.push(arguments)}
          gtag('js',new Date());
          gtag('config','G-9J8F6Q1Y2M');
        `}</Script>
        <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','1029814882379214');
          fbq('track','PageView');
        `}</Script>
      </body>
    </html>
  );
}
