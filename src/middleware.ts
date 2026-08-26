import { NextResponse, type NextRequest } from "next/server";

/**
 * CSP da rota de pagamento — observando por padrão, bloqueando só por decisão.
 *
 * Essa rota renderiza os campos `bpmpi_*` do 3DS, que carregam dados de cartão
 * no DOM. Os campos são requisito da SDK e ficam. O que não pode ficar é
 * qualquer script de origem que não seja necessária ao 3DS.
 *
 * MODO. O 3DS da Braspag só autentica no domínio de produção, então esta
 * política nunca pôde ser exercitada em preview. Uma lista de origens escrita
 * às cegas e aplicada em bloqueio recusa cartão legítimo. Por isso o padrão é
 * `report-only`: o navegador relata o que teria bloqueado e não bloqueia nada.
 * A promoção para bloqueio é mudança de `CSP_MODE` na Vercel — sem deploy de
 * código, e a reversão é a mesma variável de volta.
 *
 * O resto do site NÃO recebe esta política — o `matcher` limita o middleware
 * às rotas que renderizam campos de cartão.
 */

// Origens que o fluxo 3DS exige. A lista definitiva sai dos relatórios de
// violação colhidos em produção, não de suposição — ver /api/admin/diagnostico.
//  - 'self': chunks do Next e a SDK 3DS, que é self-hosted em /scripts/.
//  - mpi(sandbox).braspag.com.br: MPI da Braspag (init do 3DS e challenge).
//  - h.online-metrix.net: coleta de fingerprint do antifraude Cybersource.
const SDK_3DS = "https://mpi.braspag.com.br https://mpisandbox.braspag.com.br";
const FINGERPRINT = "https://h.online-metrix.net";

const ENDPOINT_RELATORIO = "/api/csp-report";

// 'unsafe-inline' é inevitável: o bootstrap do Next e a própria SDK 3DS injetam
// script inline. Nonce exigiria renderização dinâmica da rota. A restrição que
// interessa é de ORIGEM — nenhum host de analytics ou tag manager na lista, e
// nenhum entra depois: GTM aparecendo aqui se corrige no layout.
const POLITICA = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${SDK_3DS} ${FINGERPRINT}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SDK_3DS} ${FINGERPRINT} https://viacep.com.br`,
  // O challenge do 3DS abre o ACS do banco emissor, cujo domínio varia por
  // emissor e não é enumerável. Fechar esta lista reprovaria cartões de bancos
  // legítimos — o controle que vale nesta rota é o de script-src.
  `frame-src 'self' ${SDK_3DS} ${FINGERPRINT} https:`,
  // O 3DS pode submeter formulário para o ACS do emissor, com a mesma
  // imprevisibilidade de domínio do frame-src.
  `form-action 'self' ${SDK_3DS} https:`,
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  `report-uri ${ENDPOINT_RELATORIO}`,
  "report-to csp-endpoint",
].join("; ");

/** `enforce` bloqueia; qualquer outro valor (inclusive ausente) só observa. */
function modoBloqueia(): boolean {
  return (process.env.CSP_MODE || "report-only").trim().toLowerCase() === "enforce";
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // `report-to` precisa do grupo declarado; `report-uri` é o que os navegadores
  // atuais realmente honram. Mandamos os dois.
  res.headers.set(
    "Reporting-Endpoints",
    `csp-endpoint="${new URL(ENDPOINT_RELATORIO, req.nextUrl.origin).toString()}"`,
  );
  res.headers.set(
    modoBloqueia() ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    POLITICA,
  );
  return res;
}

export const config = {
  matcher: ["/reservar/:draftId/pagamento", "/braspag-3ds-test"],
};
