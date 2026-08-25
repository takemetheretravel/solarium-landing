import type { Metadata } from "next";
import { metadataBase, classesHtml } from "@/lib/layout-base";
import "../globals.css";

export const metadata: Metadata = { ...metadataBase, robots: { index: false, follow: false } };

/**
 * Layout raiz do CHECKOUT — sem GTM, sem analytics, sem chat.
 *
 * As rotas deste grupo renderizam os campos `bpmpi_*` do 3DS, que carregam
 * dados de cartão no DOM. Qualquer script de terceiro aqui enxerga esse DOM.
 *
 * A ausência do container é a razão de este layout existir: um `<AnalyticsScripts />`
 * adicionado a ele é uma regressão, e o smoke falha o build se isso acontecer.
 * Corrigir GTM aparecendo no checkout é mexer AQUI — nunca afrouxar a CSP.
 *
 * Sem Header, Footer e o botão flutuante de WhatsApp: a página de pagamento não
 * oferece saída lateral, e o botão flutuante é um alvo de clique acidental no
 * meio do preenchimento do cartão.
 */
export default function CheckoutLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={classesHtml}>
      <body className="bg-cream text-charcoal">{children}</body>
    </html>
  );
}
