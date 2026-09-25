import type { Metadata } from "next";
import Script from "next/script";
import { analyticsAtivo } from "@/config/flags";
import { serif, sans } from "../fontes";
import "../globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import FloatingWhatsApp from "@/components/ui/FloatingWhatsApp";
import { SITE_URL, SEO_PAGINAS, OG_IMAGENS } from "@/lib/seo";

// Title, description, og e twitter da home moram em `page.tsx` (via
// `metadadosDe("/")`). Aqui fica só o que toda página herda: base das URLs
// relativas, template do title e nome do site. Canonical NÃO fica aqui — o
// layout o espalharia para todas as páginas, apontando tudo para a home.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SEO_PAGINAS["/"].title, template: "%s · Solarium Mantiqueira" },
  description: SEO_PAGINAS["/"].description,
  openGraph: {
    siteName: "Solarium Mantiqueira",
    locale: "pt_BR",
    type: "website",
    images: [{ url: OG_IMAGENS.home, width: 1200, height: 630, alt: "Solarium Mantiqueira" }],
  },
  twitter: {
    card: "summary_large_image",
    images: [OG_IMAGENS.home],
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
        {analyticsAtivo() && (
          <>
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
          </>
        )}
      </body>
    </html>
  );
}
