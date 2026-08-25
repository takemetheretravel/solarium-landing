"use client";

/**
 * Camada única de escrita no `window.dataLayer`.
 *
 * Nenhuma função daqui dispara pixel, gtag ou fbq. Elas só empurram o evento; o
 * GTM decide o que fazer com ele. Isso mantém um ponto único onde o identificador
 * de conversão é definido, e permite trocar as tags sem tocar em componente.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export const CURRENCY = "BRL" as const;

export type DataLayerItem = {
  item_id: string;
  item_name: string;
  price?: number;
  quantity?: number;
  item_category?: string;
};

export type DataLayerEvent = {
  event: string;
  transaction_id: string;
  value: number;
  currency: typeof CURRENCY;
  items: DataLayerItem[];
  [extra: string]: unknown;
};

function push(evento: DataLayerEvent): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(evento);
}

/**
 * Identificador canônico da conversão.
 *
 * A regra é uma só: o número da reserva no Hostaway quando ele já existe;
 * enquanto a reserva é rascunho, o UUID do draft (o mesmo que aparece na URL
 * `/reservar/{uuid}/...`). Assim o mesmo valor percorre o funil inteiro e a
 * conversão do navegador casa com a enviada server-side.
 */
export function transactionId(params: {
  reservationId?: number | string | null;
  draftId?: string | null;
}): string {
  const reserva = params.reservationId;
  if (reserva !== undefined && reserva !== null && String(reserva).trim() !== "" && Number(reserva) > 0) {
    return String(reserva);
  }
  return String(params.draftId ?? "");
}

export function pushViewPackage(params: {
  transactionId: string;
  value: number;
  items: DataLayerItem[];
  /** Contexto de origem, quando conhecido — não afeta a identidade do evento. */
  origem?: string;
}): void {
  push({
    event: "view_package",
    transaction_id: params.transactionId,
    value: params.value,
    currency: CURRENCY,
    items: params.items,
    ...(params.origem ? { origem: params.origem } : {}),
  });
}

export function pushBeginCheckout(params: {
  transactionId: string;
  value: number;
  items: DataLayerItem[];
  paymentMethod?: "card" | "pix";
}): void {
  push({
    event: "begin_checkout",
    transaction_id: params.transactionId,
    value: params.value,
    currency: CURRENCY,
    items: params.items,
    ...(params.paymentMethod ? { payment_method: params.paymentMethod } : {}),
  });
}

/**
 * Guarda de idempotência do `purchase`, em duas camadas.
 *
 * (1) Memória de módulo: mata o disparo repetido dentro do MESMO documento —
 *     double-invoke do StrictMode, re-render, efeito que roda duas vezes.
 * (2) sessionStorage: a memória de módulo é zerada a cada recarregamento, e a
 *     confirmação recarregada é justamente o caso que duplica conversão. O
 *     escopo é a aba, não o navegador: nada persiste entre sessões (por isso
 *     sessionStorage, nunca localStorage) e uma reserva nova em outra aba não
 *     é afetada — a chave é o próprio `transaction_id`.
 */
const purchasesEmpurrados = new Set<string>();
const CHAVE_SESSAO = "solarium:purchase:";

function jaEmpurrado(id: string): boolean {
  if (purchasesEmpurrados.has(id)) return true;
  try {
    return window.sessionStorage.getItem(CHAVE_SESSAO + id) === "1";
  } catch {
    // sessionStorage bloqueado (modo restrito): sobra a camada de módulo.
    return false;
  }
}

function marcarEmpurrado(id: string): void {
  purchasesEmpurrados.add(id);
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO + id, "1");
  } catch {
    // sem persistência: segue só com a guarda de módulo.
  }
}

export function pushPurchase(params: {
  transactionId: string;
  value: number;
  items: DataLayerItem[];
  /** Repassados ao GTM para casar com o evento server-side. */
  paymentMethod?: "card" | "pix";
  nights?: number;
}): boolean {
  if (typeof window === "undefined") return false;
  const id = params.transactionId;
  if (!id) return false;
  if (jaEmpurrado(id)) return false;
  marcarEmpurrado(id);

  push({
    event: "purchase",
    transaction_id: id,
    value: params.value,
    currency: CURRENCY,
    items: params.items,
    ...(params.paymentMethod ? { payment_method: params.paymentMethod } : {}),
    ...(params.nights !== undefined ? { nights: params.nights } : {}),
  });
  return true;
}

/** Só para teste: zera a guarda de idempotência. */
export function _resetPurchaseGuard(): void {
  purchasesEmpurrados.clear();
  try {
    const chaves: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(CHAVE_SESSAO)) chaves.push(k);
    }
    for (const k of chaves) window.sessionStorage.removeItem(k);
  } catch {
    // sem sessionStorage: nada a limpar.
  }
}
