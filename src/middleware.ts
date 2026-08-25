import { NextResponse, type NextRequest } from "next/server";

/**
 * CSP restritiva SOMENTE na rota de pagamento.
 *
 * Essa rota renderiza os campos `bpmpi_*` do 3DS, que carregam dados de cartão
 * no DOM. Os campos são requisito da SDK e ficam. O que não pode ficar é
 * qualquer script de origem que não seja necessária ao 3DS: um tag manager ali
 * enxerga esse DOM inteiro.
 *
 * O resto do site NÃO recebe esta política nesta rodada — o `matcher` abaixo
 * limita o middleware à rota de pagamento.
 */

// Origens efetivamente carregadas hoje pela rota de pagamento:
//  - 'self': chunks do Next e a SDK 3DS, que é self-hosted em /scripts/.
//  - h.online-metrix.net: coleta de fingerprint do antifraude Cybersource.
//  - mpi(sandbox).braspag.com.br: MPI da Braspag (init do 3DS e challenge).
const SDK_3DS = "https://mpi.braspag.com.br https://mpisandbox.braspag.com.br";
const FINGERPRINT = "https://h.online-metrix.net";

// 'unsafe-inline' é inevitável aqui: o bootstrap do Next e a própria SDK 3DS
// injetam script inline. Usar nonce exigiria renderização dinâmica da rota.
// A restrição que interessa nesta rodada é de ORIGEM — nenhum host de
// analytics ou tag manager consta da lista.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${SDK_3DS} ${FINGERPRINT}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SDK_3DS} ${FINGERPRINT} https://viacep.com.br`,
  // O challenge do 3DS abre o ACS do banco emissor, cujo domínio varia por
  // emissor e não é enumerável. Restringir a lista aqui reprovaria cartões de
  // bancos legítimos — o controle que vale nesta rota é o de script-src.
  `frame-src 'self' ${SDK_3DS} ${FINGERPRINT} https:`,
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  return res;
}

export const config = {
  matcher: ["/reservar/:draftId/pagamento"],
};
