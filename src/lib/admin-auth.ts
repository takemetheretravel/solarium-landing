import { NextResponse } from "next/server";

/**
 * Porta única das rotas administrativas e de diagnóstico.
 *
 * POR QUE ISTO EXISTE. As rotas `/api/debug/*` eram guardadas por uma chave
 * escrita no código — `?key=lucas2026` — em repositório PÚBLICO e sem nenhum
 * gate de ambiente. Uma delas, `/api/debug/hostaway-reservation`, dispara SEIS
 * tentativas de criação de reserva contra a conta de PRODUÇÃO da Hostaway,
 * inclusive uma com `status: confirmed` e `isPaid: true`. Outra regenera o token
 * de acesso da Hostaway. Qualquer pessoa que lesse o repositório tinha as duas.
 *
 * Segredo em código-fonte não é segredo. A partir daqui, toda rota
 * administrativa usa `ADMIN_API_TOKEN`, que só existe em variável de ambiente.
 *
 * Sem o token configurado o endpoint fica FECHADO (503), nunca aberto: um
 * ambiente que esqueceu de definir a variável não pode virar um ambiente sem
 * porta.
 */

/** Comparação em tempo constante. Evita distinguir tokens pelo tempo de resposta. */
function tokenConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < recebido.length; i++) {
    diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * `null` = autorizado. Resposta pronta = recusado, e quem chama devolve ela.
 *
 * O token vem em `x-admin-token` ou `Authorization: Bearer`. NUNCA em query
 * string: URL vaza em log de servidor, histórico e Referer.
 */
export function exigirAdmin(req: Request): NextResponse | null {
  // `.trim()` nos DOIS lados: valor colado no painel da Vercel costuma carregar
  // quebra de linha invisível na ponta, e isso derrubava token correto em 401.
  const esperado = (process.env.ADMIN_API_TOKEN || "").trim();
  if (!esperado) {
    return NextResponse.json({ error: "ADMIN_API_TOKEN não configurado" }, { status: 503 });
  }

  const recebido = (
    req.headers.get("x-admin-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  ).trim();

  if (!recebido || !tokenConfere(recebido, esperado)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  return null;
}

/**
 * Rota de laboratório: exige token E recusa em produção.
 *
 * Para o que cria, cancela ou sonda coisa real no PMS. Token sozinho não basta
 * quando a ação tem efeito colateral em produção — um token vazado viraria
 * reserva de verdade no calendário.
 */
export function exigirAdminForaDeProducao(req: Request): NextResponse | null {
  const negado = exigirAdmin(req);
  if (negado) return negado;

  // `VERCEL_ENV` é o sinal da plataforma; `NODE_ENV` cobre execução local.
  const producao = process.env.VERCEL_ENV === "production";
  if (producao) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}
