// Módulo CLIENT-SIDE compartilhado do 3DS 2.0 + FingerPrint Antifraude (Braspag).
// Extraído da página de teste braspag-3ds-test (padrão validado pela Braspag).
// Usado tanto na página de teste quanto no checkout real — SEM fork da lógica.
//
// Pontos validados que este módulo preserva:
//  - Inputs bpmpi_* criados IMPERATIVAMENTE (document.createElement) fora do
//    React, num container próprio anexado ao <body> — nenhum re-render recria/
//    reseta os nós, e a remoção do bpmpi_accesstoken pelo SDK não conflita.
//  - Ordem: define bpmpi_config → busca token → injeta token + demais inputs →
//    só então anexa o script self-hosted (o SDK dispara /v2/3ds/init no load).
//  - FingerPrint: session_id = ProviderMerchantId + ProviderIdentifier (uuid sem
//    hífens); a transação usa só o ProviderIdentifier (FingerPrintId).

"use client";

const SDK_SRC = "/scripts/BP.Mpi.3ds20.min.js"; // self-hosted (mesmo domínio)
const SDK_SCRIPT_ID = "bpmpi-3ds20-sdk";
const FP_SCRIPT_ID = "bpmpi-fp-script";
const FP_HOST = "https://h.online-metrix.net";
const INPUTS_CONTAINER_ID = "bpmpi-inputs-container";

declare global {
  interface Window {
    bpmpi_config?: () => unknown;
    bpmpi_authenticate?: () => void;
  }
}

export type ThreeDSEvent =
  | "onSuccess"
  | "onFailure"
  | "onUnenrolled"
  | "onDisabled"
  | "onError"
  | "onUnsupportedBrand";

export type ThreeDSResult = {
  event: ThreeDSEvent;
  Cavv?: string;
  Eci?: string;
  Xid?: string;
  Version?: string;
  ReferenceId?: string;
  ReturnCode?: string;
  ReturnMessage?: string;
};

function pickResult(event: ThreeDSEvent, e: unknown): ThreeDSResult {
  const ev = (e || {}) as Record<string, unknown>;
  return {
    event,
    Cavv: ev.Cavv as string | undefined,
    Eci: ev.Eci as string | undefined,
    Xid: ev.Xid as string | undefined,
    Version: ev.Version as string | undefined,
    ReferenceId: ev.ReferenceId as string | undefined,
    ReturnCode: ev.ReturnCode as string | undefined,
    ReturnMessage: ev.ReturnMessage as string | undefined,
  };
}

// Endereço de cobrança para os campos bpmpi_billto_* do 3DS (challenge). Valores
// default de teste; o checkout pode sobrescrever com o billing real.
export type Bpmpi3dsBilling = {
  name?: string;
  email?: string;
  phone?: string;
  street1?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
};

const DEFAULT_BILLING: Required<Bpmpi3dsBilling> = {
  name: "Cliente Solarium",
  email: "reservas@solariummantiqueira.com",
  phone: "5535999990000",
  street1: "Rua das Flores, 100",
  city: "Itanhandu",
  state: "MG",
  country: "BR",
  zipcode: "37464000",
};

const MERCHANT_URL = "https://solariummantiqueira.com";
const ORDER_PRODUCTCODE = "PHY";
const TRANSACTION_MODE = "S";

// ---------------------------------------------------------------------------
// FingerPrint (Camada 2A) — só coleta client-side.
// ---------------------------------------------------------------------------
export async function initBraspagFingerprint(): Promise<{
  providerIdentifier: string;
  sessionId: string;
}> {
  const res = await fetch("/api/payments/braspag/af-config");
  const cfg = await res.json().catch(() => ({}));
  const orgId: string = cfg.orgId || "";
  const providerMerchantId: string = cfg.providerMerchantId || "";
  if (!orgId || !providerMerchantId) {
    throw new Error("FingerPrint: af-config ausente (BRASPAG_AF_* não configurado).");
  }
  const providerIdentifier = crypto.randomUUID().replace(/-/g, "");
  const sessionId = `${providerMerchantId}${providerIdentifier}`;

  if (!document.getElementById(FP_SCRIPT_ID)) {
    const s = document.createElement("script");
    s.id = FP_SCRIPT_ID;
    s.type = "text/javascript";
    s.async = true;
    s.src = `${FP_HOST}/fp/tags.js?org_id=${encodeURIComponent(orgId)}&session_id=${encodeURIComponent(sessionId)}`;
    document.head.appendChild(s);
  }
  return { providerIdentifier, sessionId };
}

// ---------------------------------------------------------------------------
// 3DS (Camada 1B) — autenticação no navegador.
// ---------------------------------------------------------------------------
function getContainer(): HTMLDivElement {
  let c = document.getElementById(INPUTS_CONTAINER_ID) as HTMLDivElement | null;
  if (!c) {
    c = document.createElement("div");
    c.id = INPUTS_CONTAINER_ID;
    c.style.display = "none";
    c.setAttribute("aria-hidden", "true");
    document.body.appendChild(c);
  }
  return c;
}

function setInput(container: HTMLElement, cls: string, val: string) {
  const el = container.querySelector<HTMLInputElement>(`.${cls}`);
  if (el) {
    el.value = val;
    el.setAttribute("value", val);
  }
}

// Cancela/limpa uma sessão 3DS anterior (para refazer com token novo numa
// retentativa). Remove o script e os inputs; o próximo initBraspag3ds recria.
export function resetBraspag3ds() {
  document.getElementById(SDK_SCRIPT_ID)?.remove();
  const c = document.getElementById(INPUTS_CONTAINER_ID);
  if (c) c.innerHTML = "";
  window.bpmpi_authenticate = undefined;
}

export async function initBraspag3ds(opts: {
  orderNumber: string;
  amountCentavos: number;
  installments?: number;
  billing?: Bpmpi3dsBilling;
  environment?: string; // "SDB" (sandbox) | "PRD"
  debug?: boolean;
  onReady: () => void;
  onResult: (r: ThreeDSResult) => void;
}): Promise<void> {
  const environment = opts.environment || "SDB";
  const billing = { ...DEFAULT_BILLING, ...(opts.billing || {}) };

  // (1) bpmpi_config PRECISA existir antes do script.
  window.bpmpi_config = function () {
    return {
      Debug: opts.debug ?? false,
      Environment: environment,
      onReady: opts.onReady,
      onSuccess: (e: unknown) => opts.onResult(pickResult("onSuccess", e)),
      onFailure: (e: unknown) => opts.onResult(pickResult("onFailure", e)),
      onUnenrolled: (e: unknown) => opts.onResult(pickResult("onUnenrolled", e)),
      onDisabled: () => opts.onResult({ event: "onDisabled" }),
      onError: (e: unknown) => opts.onResult(pickResult("onError", e)),
      onUnsupportedBrand: (e: unknown) => opts.onResult(pickResult("onUnsupportedBrand", e)),
    };
  };

  // (2) busca o access token.
  const res = await fetch("/api/payments/braspag/3ds-session", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) {
    const detail = data.mpiStatus !== undefined ? `MPI ${data.mpiStatus}` : data.error || `HTTP ${res.status}`;
    throw new Error(`3DS: falha ao obter access token (${detail}).`);
  }

  // (3) cria TODOS os inputs imperativamente já preenchidos (fora do React).
  const container = getContainer();
  container.innerHTML = "";
  const mk = (cls: string, val: string) => {
    const el = document.createElement("input");
    el.type = "hidden";
    el.className = cls;
    el.value = val;
    el.setAttribute("value", val);
    container.appendChild(el);
  };
  mk("bpmpi_accesstoken", String(data.accessToken));
  mk("bpmpi_auth", "true");
  mk("bpmpi_auth_notifyonly", "false");
  mk("bpmpi_ordernumber", opts.orderNumber);
  mk("bpmpi_currency", "BRL");
  mk("bpmpi_totalamount", String(opts.amountCentavos));
  mk("bpmpi_installments", String(opts.installments || 1));
  mk("bpmpi_paymentmethod", "Credit");
  mk("bpmpi_cardnumber", "");
  mk("bpmpi_cardexpirationmonth", "");
  mk("bpmpi_cardexpirationyear", "");
  mk("bpmpi_merchant_url", MERCHANT_URL);
  mk("bpmpi_order_productcode", ORDER_PRODUCTCODE);
  mk("bpmpi_transaction_mode", TRANSACTION_MODE);
  mk("bpmpi_billto_name", billing.name);
  mk("bpmpi_billto_email", billing.email);
  mk("bpmpi_billto_phonenumber", billing.phone);
  mk("bpmpi_billto_street1", billing.street1);
  mk("bpmpi_billto_city", billing.city);
  mk("bpmpi_billto_state", billing.state);
  mk("bpmpi_billto_country", billing.country);
  mk("bpmpi_billto_zipcode", billing.zipcode);

  // (4) só agora anexa o script → dispara /v2/3ds/init com o token presente.
  if (!document.getElementById(SDK_SCRIPT_ID)) {
    const s = document.createElement("script");
    s.id = SDK_SCRIPT_ID;
    s.src = SDK_SRC;
    s.async = true;
    document.body.appendChild(s);
  }
}

// Sincroniza os inputs com os valores ATUAIS e dispara a autenticação. NÃO
// toca no token (o SDK já o consumiu no init).
export function authenticate3ds(opts: {
  card: { number: string; holder: string; expirationMMYYYY: string };
  amountCentavos: number;
  orderNumber: string;
  installments: number;
  billing?: Bpmpi3dsBilling;
}): boolean {
  const container = document.getElementById(INPUTS_CONTAINER_ID);
  if (!container || typeof window.bpmpi_authenticate !== "function") return false;

  const [m = "", y = ""] = opts.card.expirationMMYYYY.split("/").map((s) => s.trim());
  setInput(container, "bpmpi_ordernumber", opts.orderNumber);
  setInput(container, "bpmpi_totalamount", String(opts.amountCentavos));
  setInput(container, "bpmpi_installments", String(opts.installments));
  setInput(container, "bpmpi_cardnumber", opts.card.number.replace(/\s/g, ""));
  setInput(container, "bpmpi_cardexpirationmonth", m);
  setInput(container, "bpmpi_cardexpirationyear", y);
  setInput(container, "bpmpi_billto_name", opts.card.holder || DEFAULT_BILLING.name);
  if (opts.billing) {
    if (opts.billing.zipcode) setInput(container, "bpmpi_billto_zipcode", opts.billing.zipcode.replace(/\D/g, ""));
    if (opts.billing.street1) setInput(container, "bpmpi_billto_street1", opts.billing.street1);
    if (opts.billing.city) setInput(container, "bpmpi_billto_city", opts.billing.city);
    if (opts.billing.state) setInput(container, "bpmpi_billto_state", opts.billing.state);
  }

  window.bpmpi_authenticate();
  return true;
}
