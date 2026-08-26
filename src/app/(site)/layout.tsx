import type { Metadata } from "next";
import { analyticsAtivo } from "@/config/flags";
import AnalyticsScripts, { GtmNoScript } from "@/lib/analytics/AnalyticsScripts";
import { metadataBase, classesHtml } from "@/lib/layout-base";
import "../globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import FloatingWhatsApp from "@/components/ui/FloatingWhatsApp";
import TrackingSite from "@/components/tracking/TrackingSite";

export const metadata: Metadata = metadataBase;

/**
 * Layout raiz do SITE — o único que carrega o GTM.
 *
 * A rota de pagamento vive no grupo `(checkout)`, com layout raiz próprio, e
 * por isso não tem como herdar o container: a exclusão é estrutural, não uma
 * checagem de rota que alguém possa afrouxar sem perceber.
 */
export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const comMedicao = analyticsAtivo();
  return (
    <html lang="pt-BR" className={classesHtml}>
      {/* O gate de AMBIENTE é aqui (só o servidor lê VERCEL_ENV): preview não
          emite medição. */}
      {comMedicao && <AnalyticsScripts />}
      <body className="bg-cream text-charcoal">
        {comMedicao && <GtmNoScript />}
        <TrackingSite />
        <Header />
        {children}
        <Footer />
        <FloatingWhatsApp />
      </body>
    </html>
  );
}
