import Script from "next/script";

/**
 * Carregador de tags do navegador.
 *
 * Um container de GTM, e nada mais. Não há `gtag.js`, snippet de Meta Pixel nem
 * inicialização de Google Ads no código do site: toda tag de navegador é
 * publicada e versionada no GTM, o que permite pausar ou trocar uma tag sem
 * deploy.
 *
 * ONDE NÃO CARREGA. Só o layout raiz de `(site)` renderiza este componente. As
 * rotas que exibem campos `bpmpi_*` do 3DS vivem no grupo `(checkout)`, cujo
 * layout raiz não tem como herdá-lo. A exclusão é estrutural — não é checagem
 * de rota em runtime, que qualquer refactor poderia contornar sem alarde.
 */

export const GTM_ID = "GTM-MRV2KVJF";

/**
 * Vai no `<head>`. Cria o `dataLayer` ANTES do container, senão os eventos
 * empurrados por componentes que montam cedo se perdem.
 */
export default function AnalyticsScripts() {
  return (
    <Script id="gtm" strategy="afterInteractive">{`
      window.dataLayer = window.dataLayer || [];
      (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
      var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
      j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
      f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');
    `}</Script>
  );
}

/** Fallback do GTM. Vai logo após a abertura do `<body>`. */
export function GtmNoScript() {
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
