// Cliente Braspag (gateway de pagamento) — em paralelo à Cielo, atrás de feature flag.
// Credenciais vêm SEMPRE de env vars; nunca hardcode (repo é público).
import { ajustarLimitesBraspag, type CampoAjustado } from "./braspag-limites";

const ENV = process.env.BRASPAG_ENVIRONMENT === "production" ? "production" : "sandbox";

export const BRASPAG_URLS = {
  transactional: ENV === "production" ? "https://api.braspag.com.br" : "https://apisandbox.braspag.com.br",
  query: ENV === "production" ? "https://apiquery.braspag.com.br" : "https://apiquerysandbox.braspag.com.br",
  mpi3ds: ENV === "production" ? "https://mpi.braspag.com.br" : "https://mpisandbox.braspag.com.br",
};

function gatewayHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    MerchantId: process.env.BRASPAG_MERCHANT_ID || "",
    MerchantKey: process.env.BRASPAG_MERCHANT_KEY || "",
    RequestId: crypto.randomUUID(),
  };
}

// SoftDescriptor que aparece na fatura do cliente. Env var opcional para ajuste
// sem deploy; fallback "Solarium Mant". Bandeiras rejeitam acentos/caracteres
// especiais → sanitizamos para ASCII (letras/números/espaço) e limitamos a 13.
function getSoftDescriptor(): string {
  const raw = process.env.BRASPAG_SOFT_DESCRIPTOR || "Solarium Mant";
  const ascii = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove marcas de acento (combining diacriticals)
    .replace(/[^A-Za-z0-9 ]/g, "") // só ASCII alfanumérico + espaço
    .trim()
    .slice(0, 13);
  return ascii || "Solarium Mant";
}

// Erro de autenticação do MPI 3DS, carregando status + corpo da resposta da
// Braspag para que a rota possa propagá-los (sem expor segredos).
export class Braspag3dsAuthError extends Error {
  status: number;
  mpiBody: unknown;
  constructor(status: number, mpiBody: unknown) {
    super(`Falha ao obter access token 3DS (HTTP ${status}).`);
    this.name = "Braspag3dsAuthError";
    this.status = status;
    this.mpiBody = mpiBody;
  }
}

// EstablishmentCode real (sandbox/produção), fornecido pela Braspag. Lido SEMPRE
// do env var — NÃO há fallback silencioso para o "1006993069" de exemplo da doc
// (esse valor só serve de exemplo no .env.example; usá-lo num ambiente real
// causa 401/MPI900). NÃO é segredo; pode ser exibido em log/tela.
export function getBraspag3dsEstablishmentCode(): string {
  const code = (process.env.BRASPAG_3DS_ESTABLISHMENT_CODE || "").trim();
  if (!code) {
    throw new Error(
      "BRASPAG_3DS_ESTABLISHMENT_CODE não configurado. Defina o EstablishmentCode real (sandbox/produção) fornecido pela Braspag — não use o 1006993069 de exemplo da doc.",
    );
  }
  return code;
}

// 1A — Access token do MPI 3DS 2.0 (browser SDK).
// Endpoint de auth do MPI: POST {mpi}/v2/auth/token, Basic base64(ClientId:ClientSecret).
// O access_token resultante é DESTINADO AO CLIENTE (vai na classe bpmpi_accesstoken
// no navegador). NUNCA expor ClientId/ClientSecret. Credenciais só em env vars.
export async function getBraspag3dsAccessToken(): Promise<string> {
  const clientId = process.env.BRASPAG_3DS_CLIENT_ID || "";
  const clientSecret = process.env.BRASPAG_3DS_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("Credenciais 3DS ausentes (BRASPAG_3DS_CLIENT_ID/BRASPAG_3DS_CLIENT_SECRET).");
  }

  // Authorization = "Basic " + base64(clientId:clientSecret). NÃO usar trim no
  // secret (preservar o "=" final do base64). Concatenação direta, sem espaços
  // extras nem quebras de linha.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // EstablishmentCode: exigido do env (sem default silencioso). NUNCA usar o
  // MerchantId do gateway aqui (são identificadores diferentes).
  // O exemplo oficial da Braspag envia o campo SEM aspas (número). Enviamos como
  // Number; se o valor do env não for numérico, mantém string (fallback defensivo).
  const establishmentCode = getBraspag3dsEstablishmentCode();
  const establishmentCodeNumeric = /^\d+$/.test(establishmentCode)
    ? Number(establishmentCode)
    : establishmentCode;
  const body = {
    EstablishmentCode: establishmentCodeNumeric,
    MerchantName: process.env.BRASPAG_3DS_MERCHANT_NAME || "Solarium Mantiqueira",
    MCC: process.env.BRASPAG_3DS_MCC || "7011", // 7011 = hospedagem
  };

  const url = `${BRASPAG_URLS.mpi3ds}/v2/auth/token`;
  // Log seguro (sem valores de segredo): só comprimentos e formato.
  console.log(
    "[Braspag:3DS auth] env=%s url=%s clientIdLen=%d secretLen=%d secretEndsWithEq=%s establishmentCode=%s",
    ENV,
    url,
    clientId.length,
    clientSecret.length,
    String(clientSecret.endsWith("=")),
    establishmentCode,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  const accessToken = (parsed as Record<string, unknown>)?.access_token;
  if (!res.ok || !accessToken) {
    console.error("[Braspag:3DS auth] FALHA", res.status, raw.slice(0, 500));
    throw new Braspag3dsAuthError(res.status, parsed);
  }
  return accessToken as string;
}

// Teste de conexão: venda simulada SEM 3DS (Provider Simulado).
// Serve apenas para validar credenciais/conectividade do gateway sandbox.
export async function createBraspagSaleSimulado(params: {
  orderId: string;
  amount: number;
  cardNumber: string;
  holder: string;
  expiration: string;
  cvv: string;
  brand: string;
  installments: number;
  customerName: string;
}) {
  const body = {
    MerchantOrderId: params.orderId,
    Customer: { Name: params.customerName },
    Payment: {
      Provider: "Simulado",
      Type: "CreditCard",
      Amount: params.amount,
      Currency: "BRL",
      Country: "BRA",
      Installments: params.installments,
      Capture: true,
      Authenticate: false,
      SoftDescriptor: "Solarium",
      CreditCard: {
        CardNumber: params.cardNumber,
        Holder: params.holder,
        ExpirationDate: params.expiration,
        SecurityCode: params.cvv,
        Brand: params.brand,
      },
    },
  };
  const res = await fetch(`${BRASPAG_URLS.transactional}/v2/sales/`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  console.log("[Braspag:Simulado]", res.status, JSON.stringify(data).slice(0, 400));
  return { status: res.status, data };
}

// Resultado normalizado das operações transacionais (autorização/captura).
export type BraspagTransactionResult = {
  status: number; // HTTP status
  providerUsed?: string; // provider de cartão efetivamente enviado
  paymentId?: string;
  returnCode?: string;
  returnMessage?: string;
  statusCode?: number; // Payment.Status (1=Autorizado, 2=Pago/Capturado, 3=Negado…)
  // Antifraude (síncrono) — presente quando FraudAnalysis é enviado.
  // `fraudStatus` alimenta o if de decisão da rota de crédito. Desde a A2a é o
  // valor NORMALIZADO: "1" ou "Accept" em texto aprovam, como o número 1.
  // Até a A1 só o número cru aprovava, e texto virava recusa indevida.
  fraudStatus?: FraudStatus; // 0=Unknown,1=Accept,2=Reject,3=Review,4=Aborted,5=Unfinished
  // Observabilidade (A1): status normalizado e valor cru como a Braspag enviou.
  fraudStatusNormalizado?: FraudStatus;
  fraudStatusCru?: unknown;
  fraudAnalysisId?: string;
  fraudScore?: number;
  fraudReasonCode?: number;
  fraudProviderReturnCode?: string;
  fraudProviderReturnMessage?: string;
  // Corpo CRU do erro da Braspag quando a resposta NÃO foi 2xx (ex.: array
  // [{Code, Message}] de credencial inválida). Sem truncar. undefined em sucesso.
  errorBody?: unknown;
  // AF3: campos que precisaram ser encurtados para caber no limite da Braspag.
  // Só nome do campo e tamanhos — nunca o conteúdo. Vazio quando nada mudou.
  camposAjustados?: CampoAjustado[];
  raw: unknown;
};

// ---------------------------------------------------------------------------
// Antifraude — normalização do FraudAnalysis.Status (rodada A1).
//
// O contrato documenta o campo como NUMÉRICO. O cast `as number` que existia
// aqui era uma aposta: se o valor chegar como texto, ele passava adiante sem
// ninguém perceber. As funções abaixo são puras e nunca lançam.
export const FRAUD_STATUS_NOMES = ["Unknown", "Accept", "Reject", "Review", "Aborted", "Unfinished"] as const;
export type FraudStatus = 0 | 1 | 2 | 3 | 4 | 5;
export type FraudStatusNome = (typeof FRAUD_STATUS_NOMES)[number];

/**
 * Normaliza para o enum numérico. Aceita número, string numérica ("3") e
 * string nominal em qualquer caixa ("Review", "review", "REVIEW"). Ausente ou
 * fora do enum vira Unknown (0).
 */
export function normalizarFraudStatus(valor: unknown): FraudStatus {
  if (typeof valor === "number") {
    return Number.isInteger(valor) && valor >= 0 && valor <= 5 ? (valor as FraudStatus) : 0;
  }
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (/^\d+$/.test(texto)) return normalizarFraudStatus(Number(texto));
    const idx = FRAUD_STATUS_NOMES.findIndex((n) => n.toLowerCase() === texto.toLowerCase());
    return idx >= 0 ? (idx as FraudStatus) : 0;
  }
  return 0;
}

/**
 * Dois grupos, e a diferença decide se a venda pode ser recusada (rodada AF2).
 *
 * DECISÃO do antifraude — a análise rodou e julgou o comprador:
 *   1 Accept · 2 Reject · 3 Review
 * FALHA TÉCNICA — a análise NÃO foi executada; não há julgamento nenhum:
 *   0 Unknown · 4 Aborted · 5 Unfinished
 *
 * Tratar falha técnica como recusa é perder venda legítima: em 22/09/2026 uma
 * compra autorizada pelo emissor (Status 1, ProviderReturnCode "00", 3DS
 * concluído) caiu em Aborted e levou void.
 */
export const FRAUD_STATUS_FALHA_TECNICA: readonly FraudStatus[] = [0, 4, 5];

export function ehFalhaTecnicaAntifraude(status: FraudStatus): boolean {
  return FRAUD_STATUS_FALHA_TECNICA.includes(status);
}

export function ehDecisaoAntifraude(status: FraudStatus): boolean {
  return !ehFalhaTecnicaAntifraude(status);
}

export function nomeFraudStatus(status: FraudStatus): FraudStatusNome {
  return FRAUD_STATUS_NOMES[status];
}

/** Rótulo para log e alerta interno. Nunca devolve "undefined". */
export function rotuloFraudStatus(valorCru: unknown): string {
  if (valorCru === undefined || valorCru === null) return "sem retorno (FraudAnalysis.Status ausente)";
  const status = normalizarFraudStatus(valorCru);
  const texto = String(valorCru).trim().slice(0, 40);
  const reconhecido = status !== 0 || texto === "0" || texto.toLowerCase() === "unknown";
  if (!reconhecido) return `Unknown (valor não reconhecido: "${texto}")`;
  const nome = nomeFraudStatus(status);
  return typeof valorCru === "number" ? nome : `${nome} (recebido como texto "${texto}")`;
}

// Chaves que podem carregar dado do hóspede ou do cartão. O repositório é
// público e os registros são lidos pela rota admin: o que casar aqui é redigido.
const CHAVE_SENSIVEL =
  /card|pan$|cvv|security|holder|expiration|name|nome|mail|identity|cpf|document|phone|telefone|address|endere|street|birth/i;

/**
 * Cópia redigida de um valor arbitrário, para persistir. Remove chaves
 * sensíveis, sequências de 13–19 dígitos (PAN), CPF e e-mails dentro de
 * textos, e limita tamanho e profundidade. Nunca lança.
 */
export function redigirParaRegistro(valor: unknown, profundidade = 0): unknown {
  if (valor === null || valor === undefined) return valor ?? null;
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor === "string") {
    return valor
      // Sem hífen como separador: com ele, os grupos de dígitos de um GUID
      // (PaymentId) viravam um "PAN" e o identificador se perdia.
      .replace(/\d(?:[ .]?\d){12,18}/g, "[numero-redigido]")
      // PAN com hífens (4-4-4-até 7). O último grupo de um GUID tem 12 dígitos
      // e não fecha a fronteira, então não casa.
      .replace(/\b\d{4}-\d{4}-\d{4}-\d{1,7}\b/g, "[numero-redigido]")
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf-redigido]")
      .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "[email-redigido]")
      .slice(0, 2000);
  }
  if (profundidade >= 5) return "[profundidade-limite]";
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => redigirParaRegistro(v, profundidade + 1));
  if (typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>).slice(0, 100)) {
      saida[chave] = CHAVE_SENSIVEL.test(chave) ? "[redigido]" : redigirParaRegistro(v, profundidade + 1);
    }
    return saida;
  }
  return String(valor).slice(0, 200);
}

export type ResumoAntifraude = {
  paymentId: string | null;
  merchantOrderId: string;
  paymentStatus: number | null;
  fraudStatus: FraudStatus;
  fraudStatusNome: FraudStatusNome;
  fraudStatusCru: unknown;
  fraudStatusRotulo: string;
  score: unknown;
  reasonCode: unknown;
  analysisId: string | null;
};

/**
 * Resumo do antifraude de uma autorização, só com o que pode ser persistido.
 * Monta a partir dos campos normalizados — nunca do `raw`, que carrega o
 * Customer inteiro.
 */
export function resumoAntifraude(auth: BraspagTransactionResult, merchantOrderId: string): ResumoAntifraude {
  const status = auth.fraudStatusNormalizado ?? normalizarFraudStatus(auth.fraudStatusCru);
  return {
    paymentId: auth.paymentId ?? null,
    merchantOrderId,
    paymentStatus: typeof auth.statusCode === "number" ? auth.statusCode : null,
    fraudStatus: status,
    fraudStatusNome: nomeFraudStatus(status),
    fraudStatusCru: redigirParaRegistro(auth.fraudStatusCru),
    fraudStatusRotulo: rotuloFraudStatus(auth.fraudStatusCru),
    score: redigirParaRegistro(auth.fraudScore),
    reasonCode: redigirParaRegistro(auth.fraudReasonCode),
    analysisId: auth.fraudAnalysisId ?? null,
  };
}

// GUID no formato 8-4-4-4-12 hex (formato do MerchantId).
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// MerchantKey costuma ter 40 chars alfanuméricos (sem hífens).
const MERCHANT_KEY_RE = /^[A-Za-z0-9]{40}$/;

// Avisos de configuração (não bloqueiam o fluxo). Usado no /test e na autorização.
export function checkBraspagConfig(): string[] {
  const warnings: string[] = [];
  const merchantId = (process.env.BRASPAG_MERCHANT_ID || "").trim();
  if (merchantId && !GUID_RE.test(merchantId)) {
    warnings.push(
      "[Braspag:config] BRASPAG_MERCHANT_ID não parece um GUID — verifique se a MerchantKey foi colada no campo errado",
    );
  }
  return warnings;
}

// Mascara um valor que pareça uma MerchantKey (40 alfanuméricos) — em diagnóstico
// exibimos só os 6 primeiros chars, para não vazar segredo.
export function maskIfSecretLike(value: string): string {
  return MERCHANT_KEY_RE.test(value) ? `${value.slice(0, 6)}…(mascarado)` : value;
}

// Provider de CARTÃO. Configurável por BRASPAG_CARD_PROVIDER. Em sandbox, default
// "Simulado" (o simulador). Em PRODUÇÃO, "Simulado" NÃO existe → se a env não
// estiver setada, erro explícito (nunca enviar "Simulado" em produção). Foi
// justamente o "Simulado" hardcoded que gerava HTTP 400 em produção.
export function getCardProvider(): string {
  const env = (process.env.BRASPAG_CARD_PROVIDER || "").trim();
  if (env) return env;
  if (ENV === "production") {
    throw new Error(
      "BRASPAG_CARD_PROVIDER não configurado — obrigatório em produção (confirmar valor com a Braspag)",
    );
  }
  return "Simulado"; // só sandbox
}

// Provider de PIX — mesma regra do cartão (evita o mesmo bug do "Simulado" em
// produção). Override por param > env BRASPAG_PIX_PROVIDER > (sandbox "Simulado"
// | produção: erro se não configurado).
export function getPixProvider(override?: string): string {
  const chosen = (override || "").trim() || (process.env.BRASPAG_PIX_PROVIDER || "").trim();
  if (chosen) return chosen;
  if (ENV === "production") {
    throw new Error(
      "BRASPAG_PIX_PROVIDER não configurado — obrigatório em produção (confirmar valor com a Braspag)",
    );
  }
  return "Simulado"; // só sandbox
}

export type BraspagAddress = {
  Street: string;
  Number: string;
  Complement?: string;
  ZipCode: string;
  City: string;
  State: string;
  Country: string; // "BRA" ou "BR" conforme campo
  District: string;
};

// ---------------------------------------------------------------------------
// Device fingerprint da Cybersource (ThreatMetrix).
// session_id do script = ProviderMerchantId + ProviderIdentifier, sem separador.
// Na autorização vai só o ProviderIdentifier, em Payment.FraudAnalysis.FingerPrintId.
// O org_id acompanha o ambiente Braspag (não o da Vercel).
// ---------------------------------------------------------------------------
const FP_HOST = "https://h.online-metrix.net";
const FP_ORG_ID = { production: "k8vif92e", sandbox: "1snn5n9w" } as const;
const FP_ID_REGEX = /^[0-9a-f]{32}$/;

export function fingerprintOrgId(): string {
  return process.env.BRASPAG_ENVIRONMENT === "production" ? FP_ORG_ID.production : FP_ORG_ID.sandbox;
}

export type FingerprintConfig = { orgId: string; providerMerchantId: string };

// null = ProviderMerchantId ausente → não carregar script nem enviar FingerPrintId.
export function fingerprintConfig(): FingerprintConfig | null {
  const providerMerchantId = (process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID || "").trim();
  if (!providerMerchantId) return null;
  return { orgId: fingerprintOrgId(), providerMerchantId };
}

// ProviderIdentifier: GUID aleatório, 32 hex sem hífens. Nenhum dado do hóspede.
export function gerarFingerprintId(): string {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}

export function fingerprintIdValido(id: unknown): id is string {
  return typeof id === "string" && FP_ID_REGEX.test(id);
}

export function fingerprintTags(cfg: FingerprintConfig, id: string): { scriptSrc: string; iframeSrc: string } {
  const qs = `org_id=${encodeURIComponent(cfg.orgId)}&session_id=${encodeURIComponent(cfg.providerMerchantId + id)}`;
  return { scriptSrc: `${FP_HOST}/fp/tags.js?${qs}`, iframeSrc: `${FP_HOST}/fp/tags?${qs}` };
}

export type BraspagFraudParams = {
  // ProviderIdentifier (uuid sem hífens, SEM o prefixo ProviderMerchantId).
  // Vai em Payment.FraudAnalysis.FingerPrintId — manual do Pagador: "o valor do
  // ProviderIdentifier deve ser enviado no parâmetro Payment.FraudAnalysis.FingerPrintId".
  // Opcional: sem ele a autorização segue sem o campo (fingerprint nunca bloqueia compra).
  browserFingerprint?: string;
  hostName?: string;
  cartItems: Array<{
    name: string;
    quantity: number;
    sku: string;
    unitPrice: number; // centavos
    risk?: string; // Low|Normal|High
    type?: string; // Default|Service|…
  }>;
  merchantDefinedFields?: Array<{ Id: number; Value: string }>;
  shipping?: { addressee?: string; method?: string; phone?: string };
};

// 1C — Autorização com autenticação externa (3DS já feito no navegador).
// POST /v2/sales/ com o bloco ExternalAuthentication (Cavv/Xid/Eci/Version/
// ReferenceID vindos do onSuccess do SDK). SEM Capture: a captura é SEPARADA
// (decisão de arquitetura: autoriza → antifraude → PUT /capture). SEM o bloco
// Credentials por ora — só incluir (com os dummies do exemplo oficial, Code
// 9999999 etc.) se a API passar a exigir.
// 2B — Autorização com ExternalAuthentication (3DS) + Antifraude Cybersource.
// O bloco `fraud` é OPCIONAL: quando presente, adiciona Payment.FraudAnalysis
// (Cybersource) e os dados de Customer exigidos pela análise (endereço completo,
// CPF, telefone, e-mail). Sem `fraud`, comporta-se como a 1C pura.
// Fluxo: Sequence "AuthorizeFirst" (autoriza PRIMEIRO, analisa depois se houve
// sucesso) — garante PaymentId mesmo em AF Reject, para rastreio. Captura
// SEPARADA (CaptureOnLowRisk=false, VoidOnHighRisk=false → decisão na rota:
// autorizou+AF Accept = captura; autorizou mas AF Reject/Review = void).
export async function createBraspagAuthorization(params: {
  orderId: string;
  amount: number; // centavos
  installments: number;
  customer: {
    name: string;
    identity: string;
    email: string;
    ipAddress: string;
    phone?: string;
    birthdate?: string;
    billingAddress?: BraspagAddress;
    deliveryAddress?: BraspagAddress;
  };
  card: { number: string; holder: string; expiration: string; cvv: string; brand: string };
  externalAuthentication: {
    Cavv: string;
    Xid: string;
    Eci: string;
    Version: string;
    ReferenceId: string;
  };
  fraud?: BraspagFraudParams;
}): Promise<BraspagTransactionResult> {
  // AF3 — PONTO ÚNICO de ajuste de tamanho. Todo campo de texto que vai à
  // Braspag passa por aqui antes de virar corpo da requisição; nada de cortes
  // espalhados pelo código. Um campo acima do limite faz a análise de risco
  // responder 400 e a transação voltar Aborted, sem motivo legível.
  // Nada disso altera o rascunho nem o que vai ao Hostaway: a função é pura.
  const { dados: limitado, ajustes: camposAjustados } = ajustarLimitesBraspag({
    orderId: params.orderId,
    customer: params.customer,
    fraud: params.fraud,
  });
  const cliente = limitado.customer;
  const f = limitado.fraud;

  const Customer: Record<string, unknown> = {
    Name: cliente.name,
    Identity: cliente.identity,
    IdentityType: "CPF",
    Email: cliente.email,
    IpAddress: cliente.ipAddress,
  };
  // Campos exigidos pela análise antifraude (endereço completo, telefone etc.).
  if (f) {
    // NÃO enviar Customer.BrowserFingerprint aqui: esse campo é do contrato do
    // Antifraude Gateway standalone. No Pagador, o fingerprint vai em
    // Payment.FraudAnalysis.FingerPrintId (o eco de Customer.BrowserFingerprint
    // vinha null e a Cybersource acusava "Device Fingerprint: Not Submitted").
    if (cliente.phone) Customer.Phone = cliente.phone;
    if (cliente.birthdate) Customer.Birthdate = cliente.birthdate;
    if (cliente.billingAddress) Customer.BillingAddress = cliente.billingAddress;
    // A Cybersource lê o Shipping a partir daqui — é o DeliveryAddress.Complement
    // que estourou 14 em 22/09.
    if (cliente.deliveryAddress) Customer.DeliveryAddress = cliente.deliveryAddress;
  }

  const cardProvider = getCardProvider();
  const Payment: Record<string, unknown> = {
    Provider: cardProvider,
    Type: "CreditCard",
    Amount: params.amount,
    Currency: "BRL",
    Country: "BRA",
    Installments: params.installments,
    Interest: "ByMerchant",
    Authenticate: true,
    Recurrent: false,
    SoftDescriptor: getSoftDescriptor(), // fatura do cliente; env BRASPAG_SOFT_DESCRIPTOR
    CreditCard: {
      CardNumber: params.card.number,
      Holder: params.card.holder,
      ExpirationDate: params.card.expiration, // "MM/AAAA"
      SecurityCode: params.card.cvv,
      Brand: params.card.brand,
      SaveCard: false,
    },
    ExternalAuthentication: {
      Cavv: params.externalAuthentication.Cavv,
      Xid: params.externalAuthentication.Xid,
      Eci: params.externalAuthentication.Eci,
      Version: params.externalAuthentication.Version,
      ReferenceID: params.externalAuthentication.ReferenceId, // API usa "ReferenceID"
    },
  };

  if (f) {
    Payment.FraudAnalysis = {
      Provider: "Cybersource",
      // AuthorizeFirst: autoriza PRIMEIRO, analisa DEPOIS (só se a autorização
      // teve sucesso, via SequenceCriteria "OnSuccess"). Assim SEMPRE há um
      // PaymentId — mesmo quando o antifraude rejeita —, o que a Braspag precisa
      // para rastrear a transação. Configurável por env para reverter sem deploy.
      Sequence: process.env.BRASPAG_AF_SEQUENCE || "AuthorizeFirst",
      SequenceCriteria: process.env.BRASPAG_AF_SEQUENCE_CRITERIA || "OnSuccess",
      // Captura SEPARADA/manual: NÃO capturar nem cancelar automaticamente —
      // a decisão (capturar vs void) é da rota, considerando autorização + AF.
      CaptureOnLowRisk: false,
      VoidOnHighRisk: false,
      TotalOrderAmount: params.amount,
      // Campo correto do fingerprint no Pagador: FingerPrintId (irmão de Browser),
      // valor = ProviderIdentifier puro (sem prefixo ProviderMerchantId). A
      // Cybersource remonta o session_id ProviderMerchantId+ProviderIdentifier.
      ...(f.browserFingerprint ? { FingerPrintId: f.browserFingerprint } : {}),
      Browser: {
        // Contrato do Pagador: Browser NÃO tem BrowserFingerprint (o exemplo
        // oficial traz só estes campos; Type = navegador, ex. "Chrome").
        // Email e IpAddress reusam os valores de Customer já ajustados (mesmos
        // limites: 100 e 45); Type é constante, 6 de 40.
        CookiesAccepted: false,
        Email: cliente.email,
        HostName: f.hostName || "",
        IpAddress: cliente.ipAddress,
        Type: "Chrome",
      },
      Cart: {
        IsGift: false,
        ReturnsAccepted: true,
        Items: f.cartItems.map((it) => ({
          Type: it.type || "Default",
          Name: it.name,
          Quantity: it.quantity,
          Sku: it.sku,
          UnitPrice: it.unitPrice,
          Risk: it.risk || "Normal",
        })),
      },
      ...(f.merchantDefinedFields?.length ? { MerchantDefinedFields: f.merchantDefinedFields } : {}),
      ...(f.shipping
        ? {
            Shipping: {
              // Os padrões vêm de Customer, já ajustado nos mesmos limites
              // (Addressee 120 = Name 120; Phone 15 = Phone 15).
              Addressee: f.shipping.addressee || cliente.name,
              Method: f.shipping.method || "None",
              Phone: f.shipping.phone || cliente.phone || "",
            },
          }
        : {}),
    };
  }

  const body = { MerchantOrderId: limitado.orderId, Customer, Payment };

  // Um campo encurtado é sinal de que o formulário está recebendo mais do que a
  // Braspag aceita. Registrar nome e tamanho ajuda a decidir se vale ajustar o
  // campo na origem — sem nunca escrever o conteúdo, que é dado do hóspede.
  if (camposAjustados.length) {
    console.warn(
      "[Braspag:limites] " + JSON.stringify({ merchantOrderId: limitado.orderId, camposAjustados }),
    );
  }

  // Avisa (sem bloquear) se as credenciais parecem mal configuradas — isso
  // explica um 400 com corpo de credencial inválida.
  for (const w of checkBraspagConfig()) console.warn(w);

  const res = await fetch(`${BRASPAG_URLS.transactional}/v2/sales/`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  // Captura o corpo CRU sempre (texto + parse). Em erro (não-2xx) o corpo é o
  // array [{Code, Message}] da Braspag — preservado sem truncar em errorBody.
  const rawText = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    raw = rawText;
  }
  const errorBody = res.ok ? undefined : (raw ?? rawText);
  const payment = (raw as { Payment?: Record<string, unknown> })?.Payment ?? {};
  const fa = (payment.FraudAnalysis ?? {}) as Record<string, unknown>;
  const replyData = (fa.ReplyData ?? {}) as Record<string, unknown>;

  // Resumo estruturado numa linha, fácil de copiar p/ a Braspag localizar a
  // transação nos logs deles. Inclui os identificadores do lado da Braspag +
  // ambiente + errorBody quando houver. NUNCA dados de cartão além de BIN/últimos 4.
  const cardDigits = params.card.number.replace(/\D/g, "");
  console.log(
    "[Braspag:authorize-result] " +
      JSON.stringify({
        env: ENV,
        baseUrl: BRASPAG_URLS.transactional,
        merchantId: maskIfSecretLike(process.env.BRASPAG_MERCHANT_ID || ""),
        providerUsed: cardProvider,
        httpStatus: res.status,
        merchantOrderId: limitado.orderId,
        cardBin: cardDigits.slice(0, 6),
        cardLast4: cardDigits.slice(-4),
        PaymentId: payment.PaymentId ?? null,
        Tid: payment.Tid ?? null,
        ProofOfSale: payment.ProofOfSale ?? null,
        AuthorizationCode: payment.AuthorizationCode ?? null,
        Status: payment.Status ?? null,
        ReturnCode: payment.ReturnCode ?? null,
        ReturnMessage: payment.ReturnMessage ?? null,
        ProviderReturnCode: payment.ProviderReturnCode ?? null,
        ProviderReturnMessage: payment.ProviderReturnMessage ?? null,
        FraudAnalysisId: fa.Id ?? null,
        FraudAnalysisStatus: fa.Status ?? null,
        FraudAnalysisReasonCode: fa.FraudAnalysisReasonCode ?? null,
        FraudScore: replyData.Score ?? null,
        errorBody: errorBody ?? null,
        camposAjustados,
      }),
  );
  return {
    status: res.status,
    providerUsed: cardProvider,
    camposAjustados,
    paymentId: payment.PaymentId as string | undefined,
    returnCode: payment.ReturnCode as string | undefined,
    returnMessage: payment.ReturnMessage as string | undefined,
    statusCode: payment.Status as number | undefined,
    fraudStatus: normalizarFraudStatus(fa.Status),
    fraudStatusNormalizado: normalizarFraudStatus(fa.Status),
    fraudStatusCru: fa.Status,
    fraudAnalysisId: typeof fa.Id === "string" ? fa.Id : undefined,
    fraudScore: replyData.Score as number | undefined,
    fraudReasonCode: fa.FraudAnalysisReasonCode as number | undefined,
    fraudProviderReturnCode: (fa.ProviderReturnCode ?? replyData.ProviderTransactionId) as string | undefined,
    fraudProviderReturnMessage: fa.ProviderReturnMessage as string | undefined,
    errorBody,
    raw,
  };
}

// Provider de Pix: resolvido por getPixProvider() (param > env > sandbox
// "Simulado" | produção: erro se não configurado). O "Simulado" NÃO é assumido
// em produção — mesmo cuidado do cartão.

// Resultado normalizado de uma cobrança Pix.
export type BraspagPixResult = {
  status: number; // HTTP
  providerUsed: string;
  paymentId?: string;
  statusCode?: number; // Payment.Status (12=Pendente, 2=Pago)
  qrCodeBase64Image?: string; // base64 da imagem (grafia varia entre versões)
  qrCodeString?: string; // copia-e-cola (EMV), se a API retornar
  qrFieldsDiagnostic?: string; // quais campos de QR vieram (nome + presente/ausente)
  returnCode?: string;
  returnMessage?: string;
  // Erro cru da Braspag (ex.: 400 [{"Code":129,"Message":"Affiliation not found"}]).
  errorCode?: number;
  errorMessage?: string;
  raw: unknown;
};

// Camada 3 — Cria uma cobrança Pix (server-side). Pix NÃO tem 3DS/SDK/fingerprint
// nem captura separada: retorna QR Code e a confirmação chega depois (webhook/
// consulta). Provider configurável (param > env BRASPAG_PIX_PROVIDER > default
// "Cielo30"). Type "Pix".
export async function createBraspagPixPayment(params: {
  orderId: string;
  amount: number; // centavos
  customer: { name: string; identity: string };
  provider?: string; // override por chamada (teste de candidatos)
}): Promise<BraspagPixResult> {
  const providerUsed = getPixProvider(params.provider);

  const body = {
    MerchantOrderId: params.orderId,
    Customer: {
      Name: params.customer.name,
      Identity: params.customer.identity, // Pix: CPF do pagador
      IdentityType: "CPF",
    },
    Payment: {
      Provider: providerUsed,
      Type: "Pix",
      Amount: params.amount,
    },
  };

  const res = await fetch(`${BRASPAG_URLS.transactional}/v2/sales/`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  const payment = (raw as { Payment?: Record<string, unknown> })?.Payment ?? {};
  // Erros do Pagador vêm como array na raiz: [{"Code":129,"Message":"..."}].
  const errEntry = Array.isArray(raw) ? (raw[0] as Record<string, unknown> | undefined) : undefined;

  // Diagnóstico dos campos de QR: a grafia varia entre versões/providers e o
  // Simulado pode não retornar a imagem. Lemos de forma defensiva e reportamos.
  const imageCandidates = ["QrcodeBase64Image", "QrCodeBase64Image", "QRCodeBase64Image"];
  const stringCandidates = ["QrcodeString", "QrCodeString", "QRCodeString", "QrcodeCopyPaste"];
  const nonEmpty = (k: string) => {
    const v = payment[k];
    return typeof v === "string" && v.length > 0;
  };
  const qrCodeBase64Image = imageCandidates.map((k) => payment[k]).find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  const qrCodeString = stringCandidates.map((k) => payment[k]).find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  const qrFieldsDiagnostic = [...imageCandidates, ...stringCandidates]
    .map((k) => `${k}=${k in payment ? (nonEmpty(k) ? `presente(${(payment[k] as string).length})` : "vazio") : "ausente"}`)
    .join(", ");

  console.log(
    "[Braspag:pix] http=%d provider=%s order=%s status=%s paymentId=%s err=%s/%s | qr: %s",
    res.status,
    providerUsed,
    params.orderId,
    String(payment.Status ?? "-"),
    String(payment.PaymentId ?? "-"),
    String(errEntry?.Code ?? "-"),
    String(errEntry?.Message ?? "-"),
    qrFieldsDiagnostic,
  );
  return {
    status: res.status,
    providerUsed,
    paymentId: payment.PaymentId as string | undefined,
    statusCode: payment.Status as number | undefined,
    qrCodeBase64Image,
    qrCodeString,
    qrFieldsDiagnostic,
    returnCode: payment.ProviderReturnCode as string | undefined,
    returnMessage: payment.ProviderReturnMessage as string | undefined,
    errorCode: errEntry?.Code as number | undefined,
    errorMessage: errEntry?.Message as string | undefined,
    raw,
  };
}

// Consulta o status atual de uma venda (Pix confirma de forma assíncrona).
// GET na API de QUERY (apiquery), não na transacional. Doc QueryV2: o Status
// fica em Payment.Status (a venda completa vem na raiz). Fallback defensivo
// para raw.Status caso alguma resposta venha "flat".
export async function consultBraspagPayment(paymentId: string): Promise<{
  status: number;
  statusCode?: number;
  foundAt: string;
  rawKeys: string;
  raw: unknown;
}> {
  const res = await fetch(
    `${BRASPAG_URLS.query}/v2/sales/${encodeURIComponent(paymentId)}`,
    { method: "GET", headers: gatewayHeaders() },
  );
  const raw = await res.json().catch(() => ({}));
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const payment = (rawObj.Payment ?? {}) as Record<string, unknown>;

  let statusCode: number | undefined;
  let foundAt = "não encontrado";
  if (typeof payment.Status === "number") {
    statusCode = payment.Status;
    foundAt = "Payment.Status";
  } else if (typeof rawObj.Status === "number") {
    statusCode = rawObj.Status as number;
    foundAt = "raw.Status";
  }
  const rawKeys = Array.isArray(raw) ? "[array]" : Object.keys(rawObj).join(",");

  console.log(
    "[Braspag:pix-status] http=%d paymentId=%s status=%s foundAt=%s rawKeys=%s",
    res.status,
    paymentId,
    String(statusCode ?? "-"),
    foundAt,
    rawKeys,
  );
  return { status: res.status, statusCode, foundAt, rawKeys, raw };
}

// 1C — Captura SEPARADA de uma autorização prévia.
// PUT /v2/sales/{paymentId}/capture?amount={amount}. Status esperado: 2.
export async function captureBraspagPayment(
  paymentId: string,
  amount: number,
): Promise<BraspagTransactionResult> {
  const res = await fetch(
    `${BRASPAG_URLS.transactional}/v2/sales/${encodeURIComponent(paymentId)}/capture?amount=${amount}`,
    { method: "PUT", headers: gatewayHeaders() },
  );
  const raw = await res.json().catch(() => ({}));
  // A resposta da captura vem "flat" (Status/ReturnCode na raiz), não sob Payment.
  const flat = raw as Record<string, unknown>;
  console.log(
    "[Braspag:capture] http=%d paymentId=%s status=%s returnCode=%s",
    res.status,
    paymentId,
    String(flat.Status ?? "-"),
    String(flat.ReturnCode ?? "-"),
  );
  return {
    status: res.status,
    paymentId,
    returnCode: flat.ReturnCode as string | undefined,
    returnMessage: flat.ReturnMessage as string | undefined,
    statusCode: flat.Status as number | undefined,
    raw,
  };
}

// Cancela uma autorização (não capturada) para não prender o limite do cliente.
// PUT /v2/sales/{paymentId}/void?amount={amount}. Usado em Reject/Review do
// antifraude, ou em qualquer falha após autorizar mas antes de capturar.
export async function voidBraspagPayment(
  paymentId: string,
  amount: number,
): Promise<BraspagTransactionResult> {
  const res = await fetch(
    `${BRASPAG_URLS.transactional}/v2/sales/${encodeURIComponent(paymentId)}/void?amount=${amount}`,
    { method: "PUT", headers: gatewayHeaders() },
  );
  const raw = await res.json().catch(() => ({}));
  const flat = raw as Record<string, unknown>;
  console.log(
    "[Braspag:void] http=%d paymentId=%s status=%s returnCode=%s",
    res.status,
    paymentId,
    String(flat.Status ?? "-"),
    String(flat.ReturnCode ?? "-"),
  );
  return {
    status: res.status,
    paymentId,
    returnCode: flat.ReturnCode as string | undefined,
    returnMessage: flat.ReturnMessage as string | undefined,
    statusCode: flat.Status as number | undefined,
    raw,
  };
}

// Mapeamento de códigos de recusa (ProviderReturnCode) → mensagem amigável.
// Análogo ao mapa da Cielo; os códigos ISO de autorização são os mesmos entre
// adquirentes. Começa pelos comuns e cai num default seguro.
/**
 * Falha do nosso lado ou do gateway (HTTP não-2xx, payload/credencial), não do
 * emissor. Nunca atribuir ao banco do hóspede o que o banco não recusou.
 */
export const MENSAGEM_FALHA_TECNICA_PAGAMENTO =
  "Não foi possível concluir o pagamento agora. Nenhum valor foi cobrado — tente novamente em instantes, pague via Pix ou fale conosco no WhatsApp.";

export function mensagemRecusaBraspag(returnCode?: string): string {
  const code = (returnCode || "").trim();
  const map: Record<string, string> = {
    "05": "Seu banco não autorizou a compra. Entre em contato com o emissor ou tente outro cartão.",
    "51": "Limite insuficiente para esta compra. Tente outro cartão ou parcele em mais vezes.",
    "70": "Limite insuficiente para esta compra. Tente outro cartão ou parcele em mais vezes.",
    "54": "Cartão vencido. Verifique a data de validade ou use outro cartão.",
    "57": "Este cartão não permite esse tipo de transação. Tente outro cartão ou pague via Pix.",
    "14": "Número do cartão inválido. Verifique os dígitos e tente novamente.",
    "82": "Código de segurança (CVV) incorreto. Verifique os 3 dígitos no verso do cartão.",
    "83": "Código de segurança (CVV) incorreto. Verifique os 3 dígitos no verso do cartão.",
    "78": "Cartão bloqueado ou não desbloqueado. Verifique com seu banco.",
    "63": "Transação não autorizada por segurança. Entre em contato com seu banco.",
  };
  if (code && map[code]) return map[code];
  return "Não foi possível aprovar o pagamento. Verifique os dados do cartão, tente outro cartão ou pague via Pix.";
}
