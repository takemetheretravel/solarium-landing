import { updateDraft, registrarBloqueioAntifraude } from "@/lib/kv-store";

/**
 * Fallback automático Braspag → Cielo depois de bloqueios do antifraude.
 *
 * POR QUE EXISTE. Em 28/08 o antifraude reprovou seis transações que o emissor
 * já tinha AUTORIZADO (reason 481, scores de 28 a 91 — score baixo rejeitado
 * indica regra fixa de perfil, do lado da Braspag). O hóspede foi deixado
 * sozinho na tela, tentou seis vezes, e só concluiu 44 minutos depois migrando
 * à mão para a Cielo. Em 02/09, oito tentativas. Isso é venda perdida.
 *
 * A regra é conservadora de propósito:
 *
 * - A PRIMEIRA tentativa não muda nada. A Braspag continua sendo a rota
 *   primária, e um bloqueio isolado pode ser transitório.
 * - No SEGUNDO bloqueio do mesmo draft, o padrão está estabelecido: não é azar,
 *   é uma regra que vai reprovar de novo. Aí o draft passa a apontar para a
 *   Cielo.
 * - A troca vale só para AQUELE draft. Nada de configuração global.
 *
 * O QUE NÃO MUDA. A rota Cielo já revalida preço e disponibilidade antes de
 * cobrar, já usa o número da reserva Hostaway como `transaction_id` do GA4 e
 * `event_id` do Meta, e já dispara conversão exclusivamente server-side. O
 * fallback só redireciona para ela — não duplica instrumentação, não move nada
 * para o cliente.
 */

/** A partir de quantos bloqueios o draft troca de gateway. */
export const BLOQUEIOS_ATE_FALLBACK = 2;

export type ResultadoFallback = {
  /** Total de bloqueios de antifraude deste draft, incluindo o atual. */
  bloqueios: number;
  /** A troca aconteceu (ou já estava feita) e o front pode reapresentar. */
  fallbackDisponivel: boolean;
};

/**
 * Registra o bloqueio e, no segundo, marca o draft para a Cielo.
 *
 * NUNCA lança: é chamada dentro do caminho de recusa, que já é ruim o bastante
 * sem virar erro 500.
 */
export async function registrarBloqueioEAvaliarFallback(
  draftId: string,
): Promise<ResultadoFallback> {
  try {
    const bloqueios = await registrarBloqueioAntifraude(draftId);

    // `registrarBloqueioAntifraude` devolve 0 quando o Redis falha. Zero não
    // dispara nada — sem contador confiável, o conservador é NÃO trocar de
    // gateway: mandar o hóspede para a Cielo por engano é pior que deixá-lo
    // tentar de novo na Braspag.
    if (bloqueios < BLOQUEIOS_ATE_FALLBACK) {
      return { bloqueios, fallbackDisponivel: false };
    }

    await updateDraft(draftId, { provider_forcado: "cielo" });

    console.log(
      `[Fallback] draftId=${draftId} motivo=af_bloqueio_${bloqueios}x ` +
        `provider_anterior=braspag provider_novo=cielo`,
    );

    return { bloqueios, fallbackDisponivel: true };
  } catch (err) {
    console.error("[Fallback] falhou ao avaliar:", (err as Error)?.message);
    return { bloqueios: 0, fallbackDisponivel: false };
  }
}
