"use client";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, params);
  window.fbq?.("trackCustom", name, params);
}

export function trackPurchase(params: { value: number; currency: string; transactionId: string }) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "purchase", {
    transaction_id: params.transactionId,
    value: params.value,
    currency: params.currency,
  });
  window.fbq?.("track", "Purchase", { value: params.value, currency: params.currency });
}

export function trackInitiateCheckout(params: { value: number; currency: string }) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "begin_checkout", { value: params.value, currency: params.currency });
  window.fbq?.("track", "InitiateCheckout", { value: params.value, currency: params.currency });
}

export function trackLead() {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "generate_lead");
  window.fbq?.("track", "Lead");
}

export function trackViewContent(params: {
  value: number | null;
  currency: string;
  contentName: string;
  contentIds: string[];
}) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "view_item", {
    currency: params.currency,
    value: params.value ?? 0,
    items: [{ item_id: params.contentIds[0], item_name: params.contentName }],
  });
  window.fbq?.("track", "ViewContent", {
    value: params.value ?? 0,
    currency: params.currency,
    content_name: params.contentName,
    content_ids: params.contentIds,
    content_type: "product",
  });
}

export function trackAddPaymentInfo(params: {
  value: number;
  currency: string;
  paymentMethod: "card" | "pix";
}) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", "add_payment_info", {
    value: params.value,
    currency: params.currency,
    payment_type: params.paymentMethod === "pix" ? "Pix" : "Cartão",
  });
  window.fbq?.("track", "AddPaymentInfo", {
    value: params.value,
    currency: params.currency,
  });
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

export function trackReservaConcluida(params: {
  tipo: "pacote" | "avulso";
  pacoteId?: string;
  total: number;
  noites: number;
  valorExtras: number;
  listing: string;
}) {
  trackEvent("reserva_concluida", {
    tipo: params.tipo,
    pacote_id: params.pacoteId ?? null,
    total: params.total,
    noites: params.noites,
    valor_extras: params.valorExtras,
    listing: params.listing,
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
