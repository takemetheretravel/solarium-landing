"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Carregador dos scripts de medição.
 *
 * A regra que este componente existe para garantir: NENHUM script de terceiro
 * na rota de pagamento. Ela renderiza os campos `bpmpi_*` do 3DS com dados de
 * cartão no DOM, e um script de analytics, tag manager, chat ou gravação de
 * sessão carregado ali tem acesso a esse DOM.
 *
 * A checagem por rota só é suficiente porque a entrada na rota de pagamento é
 * uma navegação DURA (ver GuestForm): num `router.push` o documento seria o
 * mesmo da página anterior, e os scripts já carregados continuariam vivos.
 *
 * O gate de ambiente fica no layout (server), que é quem enxerga `VERCEL_ENV`.
 */

/** Prefixos e padrões de rota onde nenhum script de terceiro pode carregar. */
const ROTAS_SEM_TERCEIROS = [
  /^\/reservar\/[^/]+\/pagamento\/?$/,
  /^\/braspag-3ds-test\/?$/,
];

export function rotaIsoladaDeTerceiros(pathname: string): boolean {
  return ROTAS_SEM_TERCEIROS.some((re) => re.test(pathname));
}

const GA4_ID = "G-9J8F6Q1Y2M";
const META_PIXEL_ID = "1029814882379214";

export default function AnalyticsScripts() {
  const pathname = usePathname() || "";
  if (rotaIsoladaDeTerceiros(pathname)) return null;

  return (
    <>
      {/* TAREFA 9 (bloqueada): este gtag.js hardcoded sai do código só depois de
          as tags equivalentes estarem validadas no GTM Preview. Removê-lo antes
          deixaria o site sem medição de Purchase durante a janela. */}
      <Script
        id="ga4"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">{`
        window.dataLayer=window.dataLayer||[];
        function gtag(){dataLayer.push(arguments)}
        gtag('js',new Date());
        gtag('config','${GA4_ID}');
      `}</Script>
      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','${META_PIXEL_ID}');
        fbq('track','PageView');
      `}</Script>
    </>
  );
}
