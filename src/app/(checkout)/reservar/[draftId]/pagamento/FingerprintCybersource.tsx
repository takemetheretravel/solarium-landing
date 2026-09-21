"use client";

import { createContext, useContext, useMemo } from "react";
import Script from "next/script";

// ProviderIdentifier da página. "" = fingerprint desligado (sem config ou
// provider não-Braspag): a autorização segue sem FingerPrintId.
const FingerprintContext = createContext<string>("");

export function useFingerprintId(): string {
  return useContext(FingerprintContext);
}

type Sessao = { id: string; scriptSrc: string };

declare global {
  interface Window {
    __solariumFingerprint?: Sessao;
  }
}

// O tags.js roda UMA vez por janela ("multiple calls to tags.js" lança erro), e
// o next/script não recarrega um id já visto. Numa navegação client-side de
// volta ao pagamento, o layout traz um identificador novo, mas o script ativo é
// o da primeira sessão — então é ESSA que a página precisa enviar. A sessão
// vale ~24h. Carregamento completo (F5) zera a janela e usa o id novo.
function sessaoDaJanela(nova: Sessao): Sessao {
  if (typeof window === "undefined") return nova;
  if (!window.__solariumFingerprint) window.__solariumFingerprint = nova;
  return window.__solariumFingerprint;
}

export default function FingerprintCybersource({
  id,
  scriptSrc,
  iframeSrc,
  children,
}: {
  id: string;
  scriptSrc: string;
  iframeSrc: string;
  children: React.ReactNode;
}) {
  const sessao = useMemo(() => sessaoDaJanela({ id, scriptSrc }), [id, scriptSrc]);

  return (
    <FingerprintContext.Provider value={sessao.id}>
      {/* Carrega assim que a página hidrata: coleta enquanto o hóspede preenche o cartão. */}
      <Script id="cybersource-fingerprint" src={sessao.scriptSrc} strategy="afterInteractive" />
      <noscript>
        <iframe
          src={iframeSrc}
          title="fp"
          style={{ width: "100px", height: "100px", border: 0, position: "absolute", top: "-5000px" }}
        />
      </noscript>
      {children}
    </FingerprintContext.Provider>
  );
}
