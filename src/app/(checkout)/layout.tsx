import type { Metadata } from "next";
import { serif, sans } from "../fontes";
import "../globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import FloatingWhatsApp from "@/components/ui/FloatingWhatsApp";

// Root layout das páginas onde o hóspede digita o cartão (rodada PAG1).
//
// É um root layout PRÓPRIO, e não um layout aninhado, de propósito: o Next faz
// carga completa ao cruzar root layouts. Entrar aqui vindo de qualquer página
// do site descarta o contexto JavaScript anterior — GA4 e Meta Pixel carregados
// lá não sobrevivem à navegação. Esconder o analytics num layout aninhado não
// bastaria: numa navegação client-side os scripts antigos continuam vivos.
//
// Nenhum script de terceiros entra neste layout. O único permitido na árvore é
// o da ThreatMetrix, no layout da rota de pagamento. Nada de next/script aqui.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Solarium Mantiqueira", template: "%s | Solarium Mantiqueira" },
  // Página de pagamento de um draft: nada a indexar.
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({
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
