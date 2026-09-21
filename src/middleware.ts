import { NextResponse, type NextRequest } from "next/server";
import { ENDPOINT_RELATORIO, GRUPO_RELATORIO, ehRotaDePagamento, gerarNonce, politicaPagamento } from "@/lib/csp";

// CSP em REPORT-ONLY na página de pagamento (rodada PAG1b). Só observa: nada é
// bloqueado, em rota nenhuma. O resto do site não recebe CSP.
//
// O nonce vai no header do REQUEST (`content-security-policy-report-only`):
// é de lá que o Next o lê para marcar os scripts inline dele. A rota já é
// dinâmica (force-dynamic no layout do pagamento), então cada resposta tem o seu.
export function middleware(req: NextRequest) {
  // O matcher já restringe; a checagem aqui garante que nenhuma outra rota
  // receba o header se o matcher for alargado por engano.
  if (!ehRotaDePagamento(req.nextUrl.pathname)) return NextResponse.next();

  const nonce = gerarNonce();
  const politica = politicaPagamento(nonce, { dev: process.env.NODE_ENV === "development" });

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy-report-only", politica);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy-Report-Only", politica);
  // `report-to` precisa do grupo declarado; `report-uri` é o que todos os
  // navegadores ainda honram. Vão os dois.
  res.headers.set(
    "Reporting-Endpoints",
    `${GRUPO_RELATORIO}="${new URL(ENDPOINT_RELATORIO, req.nextUrl.origin).toString()}"`,
  );
  return res;
}

export const config = {
  matcher: ["/reservar/:draftId/pagamento"],
};
