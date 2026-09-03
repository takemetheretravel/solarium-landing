/**
 * Diagnóstico do 401 nos crons.
 *
 * `/api/hostaway/finalizar-pagamentos` respondeu 401 em **144 de 144**
 * execuções, e `/api/payments/braspag/pix-reconcile` em 100% das diárias. Duas
 * filas inteiras paradas há semanas, e o log não dizia nada além do 401 — cada
 * investigação recomeçava do zero.
 *
 * Três booleanos separam as causas possíveis EM UMA execução:
 *
 * | header_presente | secret_configurado | match | Causa |
 * |---|---|---|---|
 * | false | true  | false | A Vercel não está mandando o header: `CRON_SECRET` não existe no projeto. |
 * | true  | false | false | O runtime não tem o segredo (variável ausente no ambiente do deployment). |
 * | true  | true  | false | Os dois existem e **divergem** — valor colado errado, ou espaço/quebra na ponta. |
 * | false | false | false | Nenhum dos dois: o endpoint nem deveria ter chegado aqui (503 antes). |
 *
 * NUNCA registra o segredo, nem parte dele, nem seu comprimento junto do valor.
 * O comprimento sozinho entra porque é o que denuncia espaço invisível na ponta
 * — a causa que já derrubou um token correto neste projeto.
 */
export function logarAuthDoCron(rota: string, req: Request): void {
  try {
    const cronSecret = (process.env.CRON_SECRET || "").trim();
    const segredoProprio = (
      process.env.HOSTAWAY_FINALIZE_SECRET ||
      process.env.BRASPAG_RECONCILE_SECRET ||
      ""
    ).trim();

    const authBruto = req.headers.get("authorization") || "";
    const auth = authBruto.replace(/^Bearer\s+/i, "").trim();
    const url = new URL(req.url);
    const proprioBruto =
      req.headers.get("x-reconcile-secret") || url.searchParams.get("secret") || "";
    const proprio = proprioBruto.trim();

    const headerPresente = Boolean(authBruto || proprioBruto);
    const secretConfigurado = Boolean(cronSecret || segredoProprio);
    const match =
      (Boolean(cronSecret) && auth === cronSecret) ||
      (Boolean(segredoProprio) && proprio === segredoProprio);

    console.error(
      `[Cron:auth] rota=${rota} header_presente=${headerPresente} ` +
        `secret_configurado=${secretConfigurado} match=${match} ` +
        // Comprimentos, nunca conteúdo. Diferença de 1 costuma ser quebra de
        // linha colada junto do valor no painel.
        `len_recebido=${(auth || proprio).length} len_esperado=${(cronSecret || segredoProprio).length} ` +
        `via=${authBruto ? "authorization" : proprioBruto ? "x-reconcile-secret/query" : "nenhum"}`,
    );
  } catch {
    // Diagnóstico nunca derruba a rota.
  }
}
