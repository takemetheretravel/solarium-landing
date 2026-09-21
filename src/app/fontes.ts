import { Cormorant_Garamond, Inter } from "next/font/google";

// Fontes dos dois root layouts — (site) e (checkout). Um lugar só, para as duas
// árvores nunca divergirem de tipografia.
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
