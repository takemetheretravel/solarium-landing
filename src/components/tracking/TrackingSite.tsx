"use client";

import { useEffect } from "react";
import { capturarAtribuicao } from "@/lib/analytics/atribuicao";
import { pushWhatsAppClick, pushGenerateLead } from "@/lib/analytics/dataLayer";

/**
 * Instrumentação de base do site: atribuição da sessão e cliques de WhatsApp.
 *
 * O WhatsApp é medido por um listener DELEGADO no documento, não por handler em
 * cada link. Os links vivem em oito arquivos, boa parte deles componentes de
 * servidor, e um handler por link é a garantia de que o próximo link nasça sem
 * medição. Aqui há um lugar só, e ele cobre inclusive o que ainda não existe.
 *
 * Montado apenas pelo layout de `(site)`: a rota de pagamento não instrumenta
 * nada.
 */
export default function TrackingSite() {
  useEffect(() => {
    capturarAtribuicao();

    function aoClicar(e: MouseEvent) {
      const alvo = e.target as Element | null;
      const link = alvo?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute("href") || "";
      if (!/^https?:\/\/(api\.)?wa\.me\//i.test(href) && !href.includes("api.whatsapp.com")) return;

      const origem = window.location.pathname || "/";
      pushWhatsAppClick({ origem });
      // Falar com o concierge É o contato qualificado deste negócio — não há
      // outro formulário de lead. `pushGenerateLead` tem guarda de sessão, então
      // a segunda conversa do mesmo visitante não vira um lead novo.
      pushGenerateLead({ leadSource: "whatsapp" });
    }

    // Fase de captura: o clique é medido mesmo que algo adiante chame
    // stopPropagation.
    document.addEventListener("click", aoClicar, { capture: true });
    return () => document.removeEventListener("click", aoClicar, { capture: true });
  }, []);

  return null;
}
