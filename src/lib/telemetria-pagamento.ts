/**
 * Vocabulário da telemetria do fluxo de pagamento, e o emissor do lado cliente.
 *
 * Uma lista só, compartilhada entre a rota e a página: etapa que o cliente
 * inventa e o servidor não conhece some em silêncio, e um vocabulário duplicado
 * garantiria que isso acontecesse na primeira renomeação.
 */

export const ETAPAS_TELEMETRIA = [
  "3ds_iniciado",
  "3ds_desafio_exibido",
  "3ds_retorno_sucesso",
  "3ds_retorno_falha",
  "3ds_timeout",
  "submit_iniciado",
  "submit_erro_rede",
  "pagina_abandonada",
] as const;

export type EtapaTelemetria = (typeof ETAPAS_TELEMETRIA)[number];

/**
 * Quanto esperar pelo retorno do SDK antes de declarar timeout.
 *
 * 120s é folgado de propósito. O desafio do 3DS pode envolver o hóspede abrindo
 * o app do banco, e um limite curto marcaria como falha um fluxo que ainda ia
 * completar — poluindo justamente o sinal que estamos criando para enxergar.
 */
export const TIMEOUT_3DS_MS = 120_000;

const ENDPOINT = "/api/payments/telemetry";

/**
 * Envia um evento. Nunca lança, nunca espera resposta, nunca atrapalha o fluxo.
 *
 * `sendBeacon` primeiro: é o único que sobrevive à navegação e ao fechamento da
 * aba, que é exatamente quando `pagina_abandonada` precisa sair. O `fetch` com
 * `keepalive` é o reserva para quem não tem `sendBeacon`.
 */
export function emitirTelemetria(dados: {
  draftId: string;
  provider: string;
  etapa: EtapaTelemetria;
  detalhe?: string;
}): void {
  if (typeof window === "undefined") return;

  const corpo = JSON.stringify({
    draftId: dados.draftId,
    provider: dados.provider,
    etapa: dados.etapa,
    // Truncado já aqui, além do corte no servidor: nada de PII, nada longo.
    detalhe: (dados.detalhe || "").slice(0, 200),
    userAgent: navigator.userAgent?.slice(0, 200),
  });

  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([corpo], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // cai no fetch abaixo
  }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Medição jamais derruba pagamento.
  }
}
