"use client";

/**
 * Camada única de escrita no `window.dataLayer`.
 *
 * Nenhuma função daqui dispara pixel, gtag ou fbq — o site não carrega nenhum
 * dos dois. Elas só empurram o evento; quem decide o que fazer com ele é o GTM.
 *
 * NÃO EXISTE push de compra aqui, e não é omissão. `purchase` é enviado
 * exclusivamente server-side (ver `server-conversions.ts`), depois de o
 * pagamento estar confirmado e a reserva existir no Hostaway. Uma função de
 * compra neste módulo seria código morto convidando a ser reativado, e
 * conversão contada duas vezes.
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

type EventoDataLayer = {
  event: string;
  [campo: string]: unknown;
};

function push(evento: EventoDataLayer): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(evento);
}

/**
 * Identificador canônico da conversão: o número da reserva no Hostaway quando
 * já existe; enquanto é rascunho, o UUID do draft (o mesmo de `/reservar/{uuid}/...`).
 *
 * Só faz sentido a partir do `begin_checkout` — antes disso não há reserva nem
 * draft, e os eventos de visualização não carregam o campo.
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

// ---------------------------------------------------------------------------
// Guarda de idempotência por sessão.
//
// Vale só para os eventos que marcam INTENÇÃO única (`begin_checkout`,
// `generate_lead`): sem ela, um clique duplo ou um efeito que roda duas vezes
// contam duas intenções onde houve uma. Visualização não entra — ver a mesma
// página de novo é um evento novo, legítimo.
//
// Escopo de aba (`sessionStorage`), nunca `localStorage`: nada persiste entre
// sessões, e uma segunda reserva amanhã não é barrada pela de hoje.
const empurradosNoModulo = new Set<string>();
const PREFIXO_SESSAO = "solarium:dl:";

function jaEmpurrado(chave: string): boolean {
  if (empurradosNoModulo.has(chave)) return true;
  try {
    return window.sessionStorage.getItem(PREFIXO_SESSAO + chave) === "1";
  } catch {
    // sessionStorage bloqueado: sobra a guarda de módulo.
    return false;
  }
}

function marcarEmpurrado(chave: string): void {
  empurradosNoModulo.add(chave);
  try {
    window.sessionStorage.setItem(PREFIXO_SESSAO + chave, "1");
  } catch {
    // sem persistência: segue só com a guarda de módulo.
  }
}

/** Só para teste: zera as guardas. */
export function _resetGuardas(): void {
  empurradosNoModulo.clear();
  try {
    const chaves: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(PREFIXO_SESSAO)) chaves.push(k);
    }
    for (const k of chaves) window.sessionStorage.removeItem(k);
  } catch {
    // sem sessionStorage: nada a limpar.
  }
}

// ---------------------------------------------------------------------------
// Eventos

/**
 * `value` só existe quando o preço veio da Hostaway. Um evento de receita
 * montado sobre preço aproximado contabiliza dinheiro que ninguém cotou, então
 * `value` ausente ou não-finito derruba o push inteiro.
 */
function precoUtilizavel(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function pushViewItem(params: {
  itemId: string;
  itemName: string;
  value: number | null;
}): boolean {
  if (!precoUtilizavel(params.value)) return false;
  push({
    event: "view_item",
    // Sem `transaction_id`: nesta etapa não existe reserva nem draft, e mandar
    // string vazia criaria um identificador falso no relatório.
    value: params.value,
    currency: CURRENCY,
    items: [{ item_id: params.itemId, item_name: params.itemName, price: params.value, quantity: 1 }],
  });
  return true;
}

export function pushViewPackage(params: {
  itemId: string;
  itemName: string;
  value: number | null;
}): boolean {
  if (!precoUtilizavel(params.value)) return false;
  push({
    event: "view_item",
    value: params.value,
    currency: CURRENCY,
    items: [
      {
        item_id: params.itemId,
        item_name: params.itemName,
        price: params.value,
        quantity: 1,
        item_category: "pacote",
      },
    ],
  });
  return true;
}

export function pushBeginCheckout(params: {
  transactionId: string;
  value: number | null;
  items: DataLayerItem[];
  paymentMethod?: "card" | "pix";
}): boolean {
  if (typeof window === "undefined") return false;
  if (!params.transactionId) return false;
  if (!precoUtilizavel(params.value)) return false;

  const chave = `begin_checkout:${params.transactionId}`;
  if (jaEmpurrado(chave)) return false;
  marcarEmpurrado(chave);

  push({
    event: "begin_checkout",
    transaction_id: params.transactionId,
    value: params.value,
    currency: CURRENCY,
    items: params.items,
    ...(params.paymentMethod ? { payment_method: params.paymentMethod } : {}),
  });
  return true;
}

export function pushGenerateLead(params: { leadSource: string }): boolean {
  if (typeof window === "undefined") return false;
  const chave = `generate_lead:${params.leadSource}`;
  if (jaEmpurrado(chave)) return false;
  marcarEmpurrado(chave);

  push({ event: "generate_lead", lead_source: params.leadSource });
  return true;
}

/**
 * Clique em WhatsApp. Sem guarda de sessão de propósito: o hóspede que volta ao
 * WhatsApp depois de olhar mais uma casa fez um contato novo, não um repetido.
 */
export function pushWhatsAppClick(params: { origem: string }): void {
  push({ event: "whatsapp_click", origem: params.origem });
}
