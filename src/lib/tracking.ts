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
