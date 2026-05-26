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
