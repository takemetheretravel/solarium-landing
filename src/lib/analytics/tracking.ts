"use client";

/**
 * Eventos de PRODUTO — os que medem o experimento de pacotes e o uso dos
 * extras. Não são eventos de e-commerce: `view_item`, `begin_checkout`,
 * `generate_lead` e `whatsapp_click` moram em `dataLayer.ts`.
 *
 * Todos empurram para o `window.dataLayer` e param por aí. O site não carrega
 * `gtag.js` nem o pixel do Meta — quem lê o `dataLayer` e dispara tag é o GTM.
 * Antes daqui as chamadas iam direto em `window.gtag`/`window.fbq`; com o GTM
 * como único carregador esses globais não existem mais, e continuar chamando
 * seria perder o evento em silêncio.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Empurra `{ event: name, ...params }`. Único caminho de saída deste módulo. */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...(params ?? {}) });
}

// ---------------------------------------------------------------------------
// PACOTES V2 — instrumentação da §10
//
// Sem estes eventos não há leitura possível do experimento em 60 dias. Os
// scripts de analytics só carregam em produção, então no preview estas chamadas
// são no-op silenciosos.
// ---------------------------------------------------------------------------

export type OrigemPacote = "home" | "pacotes" | "direto";
export type ContextoExtra = "pacote" | "casa" | "checkout";

export function trackPacoteVisualizado(params: { pacoteId: string; origem: OrigemPacote }) {
  trackEvent("pacote_visualizado", {
    pacote_id: params.pacoteId,
    origem: params.origem,
  });
}

export function trackPacoteDatasSelecionadas(params: {
  pacoteId: string;
  checkin: string;
  checkout: string;
  compativel: boolean;
}) {
  trackEvent("pacote_datas_selecionadas", {
    pacote_id: params.pacoteId,
    checkin: params.checkin,
    checkout: params.checkout,
    compativel: params.compativel,
  });
}

export function trackExtraSelecionado(params: {
  extraId: string;
  contexto: ContextoExtra;
  qtd: number;
}) {
  trackEvent("extra_selecionado", {
    extra_id: params.extraId,
    contexto: params.contexto,
    qtd: params.qtd,
  });
}

export function trackExtraRemovido(params: { extraId: string; contexto: ContextoExtra }) {
  trackEvent("extra_removido", {
    extra_id: params.extraId,
    contexto: params.contexto,
  });
}

export function trackPacoteCtaReserva(params: {
  pacoteId: string;
  total: number;
  bonusAplicado: boolean;
}) {
  trackEvent("pacote_cta_reserva", {
    pacote_id: params.pacoteId,
    total: params.total,
    bonus_aplicado: params.bonusAplicado,
  });
}

/**
 * Pacote sugerido na página de escolha da casa, com as datas já buscadas.
 *
 * `clicou` distingue exibição de interesse: sem isso não dá para julgar se o
 * bloco vale o espaço que ocupa na página de escolha da casa.
 */
export function trackPacoteSugeridoNaBusca(p: { pacoteId: string; clicou: boolean }): void {
  trackEvent("pacote_sugerido_na_busca", {
    pacote_id: p.pacoteId,
    clicou: p.clicou,
  });
}

/**
 * Pacote sugerido em datas VIZINHAS às pedidas, quando as pedidas não fecham
 * nenhum. `deslocamento` é a distância em noites — sem ela não dá para saber se
 * o cliente aceita mudar a data ou só ignora a sugestão.
 */
export function trackPacoteSugeridoDataProxima(p: {
  pacoteId: string;
  deslocamentoNoites: number;
  /** "proxima" = a poucas noites das pedidas; "equivalente" = próximo período do mesmo tipo. */
  tipo: "proxima" | "equivalente";
  clicou: boolean;
}): void {
  trackEvent("pacote_sugerido_data_proxima", {
    pacote_id: p.pacoteId,
    deslocamento_noites: p.deslocamentoNoites,
    tipo: p.tipo,
    clicou: p.clicou,
  });
}
