/**
 * Flags de ambiente. Toda flag tem default que reproduz o comportamento atual —
 * ligar é sempre uma ação explícita, e só vale após redeploy na Vercel.
 */

/**
 * Pacotes V2: motor de preço novo, bloco de extras, página /pacotes e reordenação
 * da home. Desligada, o site renderiza exatamente como hoje.
 */
export function pacotesV2Ativo(): boolean {
  return process.env.NEXT_PUBLIC_PACOTES_V2 === "true";
}

/** True em produção. Fora disso: sem indexação, sem analytics, reservas marcadas. */
export function ehProducao(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Reserva de teste: prefixa o hóspede com [TESTE], marca o alerta interno e o
 * authlog. Só existe no preview — em produção nunca liga, mesmo que a env vaze.
 */
export function reservaTeste(): boolean {
  return process.env.RESERVA_TESTE === "true" && !ehProducao();
}

/** Analytics só dispara em produção. Preview não suja a base do experimento. */
export function analyticsAtivo(): boolean {
  return ehProducao();
}

/**
 * Review do antifraude (rodadas A2a, A2b e A3). Ligada, um Review deixa a
 * autorização viva, segura as noites e espera a decisão do analista. Desligada,
 * Review cai no void como antes.
 *
 * As três rodadas só fazem sentido juntas: ligar sem a A3 deixa o hóspede em
 * espera sem desfecho.
 */
export function antifraudeReviewAtivo(): boolean {
  return process.env.ANTIFRAUDE_REVIEW_ENABLED?.trim().toLowerCase() === "true";
}

export const PREFIXO_RESERVA_TESTE = "[TESTE]";
