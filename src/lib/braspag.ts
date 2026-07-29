// Cliente Braspag (gateway de pagamento) — em paralelo à Cielo, atrás de feature flag.
// Credenciais vêm SEMPRE de env vars; nunca hardcode (repo é público).
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
  paymentId?: string;
  returnCode?: string;
  returnMessage?: string;
  statusCode?: number; // Payment.Status (1=Autorizado, 2=Pago/Capturado, 3=Negado…)
  // Antifraude (síncrono) — presente quando FraudAnalysis é enviado.
  fraudStatus?: number; // 0=Unknown,1=Accept,2=Reject,3=Review,4=Aborted,5=Unfinished
  fraudScore?: number;
  fraudReasonCode?: number;
  fraudProviderReturnCode?: string;
  fraudProviderReturnMessage?: string;
  raw: unknown;
};

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

export type BraspagFraudParams = {
  // ProviderIdentifier (uuid sem hífens, SEM o prefixo ProviderMerchantId).
  // Vai em Payment.FraudAnalysis.FingerPrintId — manual do Pagador: "o valor do
  // ProviderIdentifier deve ser enviado no parâmetro Payment.FraudAnalysis.FingerPrintId".
  browserFingerprint: string;
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
// Fluxo: Sequence "AnalyseFirst" (análise ANTES da autorização) + captura
// SEPARADA (CaptureOnLowRisk=false, VoidOnHighRisk=false → decisão manual).
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
  const f = params.fraud;

  const Customer: Record<string, unknown> = {
    Name: params.customer.name,
    Identity: params.customer.identity,
    IdentityType: "CPF",
    Email: params.customer.email,
    IpAddress: params.customer.ipAddress,
  };
  // Campos exigidos pela análise antifraude (endereço completo, telefone etc.).
  if (f) {
    // NÃO enviar Customer.BrowserFingerprint aqui: esse campo é do contrato do
    // Antifraude Gateway standalone. No Pagador, o fingerprint vai em
    // Payment.FraudAnalysis.FingerPrintId (o eco de Customer.BrowserFingerprint
    // vinha null e a Cybersource acusava "Device Fingerprint: Not Submitted").
    if (params.customer.phone) Customer.Phone = params.customer.phone;
    if (params.customer.birthdate) Customer.Birthdate = params.customer.birthdate;
    if (params.customer.billingAddress) Customer.BillingAddress = params.customer.billingAddress;
    if (params.customer.deliveryAddress) Customer.DeliveryAddress = params.customer.deliveryAddress;
  }

  const Payment: Record<string, unknown> = {
    Provider: "Simulado",
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
      Sequence: "AnalyseFirst", // análise ANTES da autorização
      SequenceCriteria: "Always",
      // Captura SEPARADA/manual: NÃO capturar nem cancelar automaticamente —
      // a decisão fica no botão, considerando o resultado da análise.
      CaptureOnLowRisk: false,
      VoidOnHighRisk: false,
      TotalOrderAmount: params.amount,
      // Campo correto do fingerprint no Pagador: FingerPrintId (irmão de Browser),
      // valor = ProviderIdentifier puro (sem prefixo ProviderMerchantId). A
      // Cybersource remonta o session_id ProviderMerchantId+ProviderIdentifier.
      FingerPrintId: f.browserFingerprint,
      Browser: {
        // Contrato do Pagador: Browser NÃO tem BrowserFingerprint (o exemplo
        // oficial traz só estes campos; Type = navegador, ex. "Chrome").
        CookiesAccepted: false,
        Email: params.customer.email,
        HostName: f.hostName || "",
        IpAddress: params.customer.ipAddress,
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
              Addressee: f.shipping.addressee || params.customer.name,
              Method: f.shipping.method || "None",
              Phone: f.shipping.phone || params.customer.phone || "",
            },
          }
        : {}),
    };
  }

  const body = { MerchantOrderId: params.orderId, Customer, Payment };

  const res = await fetch(`${BRASPAG_URLS.transactional}/v2/sales/`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  const payment = (raw as { Payment?: Record<string, unknown> })?.Payment ?? {};
  const fa = (payment.FraudAnalysis ?? {}) as Record<string, unknown>;
  const replyData = (fa.ReplyData ?? {}) as Record<string, unknown>;

  // Resumo estruturado numa linha, fácil de copiar p/ a Braspag localizar a
  // transação nos logs deles. Inclui os identificadores do lado da Braspag +
  // ambiente. NUNCA dados de cartão além de BIN/últimos 4.
  const cardDigits = params.card.number.replace(/\D/g, "");
  console.log(
    "[Braspag:authorize-result] " +
      JSON.stringify({
        env: ENV,
        baseUrl: BRASPAG_URLS.transactional,
        merchantId: process.env.BRASPAG_MERCHANT_ID || "",
        httpStatus: res.status,
        merchantOrderId: params.orderId,
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
      }),
  );
  return {
    status: res.status,
    paymentId: payment.PaymentId as string | undefined,
    returnCode: payment.ReturnCode as string | undefined,
    returnMessage: payment.ReturnMessage as string | undefined,
    statusCode: payment.Status as number | undefined,
    fraudStatus: fa.Status as number | undefined,
    fraudScore: replyData.Score as number | undefined,
    fraudReasonCode: fa.FraudAnalysisReasonCode as number | undefined,
    fraudProviderReturnCode: (fa.ProviderReturnCode ?? replyData.ProviderTransactionId) as string | undefined,
    fraudProviderReturnMessage: fa.ProviderReturnMessage as string | undefined,
    raw,
  };
}

// Default do provider de Pix em SANDBOX: "Simulado" — confirmado pela Braspag
// após habilitarem a afiliação Pix na conta (o manual público usa "Cielo30",
// mas o simulador de sandbox é o Simulado). Override por env/param.
export const BRASPAG_PIX_PROVIDER_DEFAULT = "Simulado";

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
  const providerUsed =
    params.provider?.trim() || process.env.BRASPAG_PIX_PROVIDER || BRASPAG_PIX_PROVIDER_DEFAULT;

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
