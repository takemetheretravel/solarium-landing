import { redact } from "@/lib/log/redact";
export function mensagemRecusa(returnCode?: string): string {
  const code = (returnCode || "").trim();
  const map: Record<string, string> = {
    "83": "Código de segurança (CVV) incorreto. Verifique os 3 dígitos no verso do cartão.",
    "82": "Código de segurança (CVV) incorreto. Verifique os 3 dígitos no verso do cartão.",
    "05": "Seu banco não autorizou a compra. Entre em contato com o emissor do cartão ou tente outro cartão.",
    "57": "Este cartão não permite esse tipo de transação. Tente outro cartão ou pague via Pix.",
    "51": "Limite insuficiente para esta compra. Tente outro cartão ou parcele em mais vezes.",
    "70": "Limite insuficiente para esta compra. Tente outro cartão ou parcele em mais vezes.",
    "54": "Cartão vencido. Verifique a data de validade ou use outro cartão.",
    "14": "Número do cartão inválido. Verifique os dígitos e tente novamente.",
    "78": "Cartão bloqueado ou não desbloqueado. Verifique com seu banco.",
    "63": "Transação não autorizada por segurança. Entre em contato com seu banco.",
    "99": "Não conseguimos processar agora. Aguarde alguns instantes e tente novamente.",
  };
  if (code && map[code]) return map[code];
  return "Não foi possível aprovar o pagamento. Verifique os dados do cartão, tente outro cartão ou pague via Pix.";
}

// Texto curto para o email de alerta (uso interno)
export function motivoRecusaInterno(returnCode?: string, returnMessage?: string): string {
  const code = (returnCode || "").trim();
  const internos: Record<string, string> = {
    "83": "CVV incorreto", "82": "CVV incorreto",
    "05": "Banco emissor não autorizou", "57": "Cartão não permite transação",
    "51": "Limite insuficiente", "70": "Limite insuficiente",
    "54": "Cartão vencido", "14": "Número inválido",
    "78": "Cartão bloqueado", "63": "Bloqueio de segurança", "99": "Timeout/erro Cielo",
  };
  const label = code && internos[code] ? internos[code] : (returnMessage || "Recusa desconhecida");
  return `${label} (código ${code || "?"})`;
}

const isSandbox = process.env.CIELO_ENVIRONMENT === "sandbox";
const BASE_URL = isSandbox
  ? "https://apisandbox.cieloecommerce.cielo.com.br"
  : "https://api.cieloecommerce.cielo.com.br";
const QUERY_URL = isSandbox
  ? "https://apiquerysandbox.cieloecommerce.cielo.com.br"
  : "https://apiquery.cieloecommerce.cielo.com.br";

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    MerchantId: process.env.CIELO_MERCHANT_ID!,
    MerchantKey: process.env.CIELO_MERCHANT_KEY!,
    RequestId: crypto.randomUUID(),
  };
}

export async function createPixPayment(params: {
  orderId: string;
  amount: number;
  customerName: string;
  customerCpf: string;
  customerEmail: string;
}) {
  const body = {
    MerchantOrderId: params.orderId,
    Customer: {
      Name: params.customerName,
      Identity: params.customerCpf.replace(/\D/g, ""),
      IdentityType: "CPF",
      Email: params.customerEmail,
    },
    Payment: {
      Type: "Pix",
      Amount: params.amount,
      SoftDescriptor: "Solarium Mantiqueira",
    },
  };

  const res = await fetch(`${BASE_URL}/1/sales/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("[Cielo:Pix] Error:", JSON.stringify(redact(data)));
    throw new Error(`Cielo Pix error: ${res.status}`);
  }

  return {
    paymentId: data.Payment?.PaymentId as string,
    qrCodeBase64: data.Payment?.QrCodeBase64Image as string,
    qrCodeString: data.Payment?.QrCodeString as string,
    status: data.Payment?.Status as number,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export async function createCreditPayment(params: {
  orderId: string;
  amount: number;
  installments: number;
  cardNumber: string;
  cardHolder: string;
  cardExpiration: string;
  cardCvv: string;
  customerName: string;
  customerCpf: string;
  customerEmail: string;
}) {
  const body = {
    MerchantOrderId: params.orderId,
    Customer: {
      Name: params.customerName,
      Identity: params.customerCpf.replace(/\D/g, ""),
      IdentityType: "CPF",
      Email: params.customerEmail,
    },
    Payment: {
      Type: "CreditCard",
      Amount: params.amount,
      Installments: params.installments,
      SoftDescriptor: "Solarium Mantiqueira",
      Capture: true,
      Authenticate: false,
      CreditCard: {
        CardNumber: params.cardNumber.replace(/\s/g, ""),
        Holder: params.cardHolder,
        ExpirationDate: normalizeExpiration(params.cardExpiration),
        SecurityCode: params.cardCvv,
        Brand: detectBrand(params.cardNumber),
      },
    },
  };

  // A validade do cartão não vai para o log (é dado de cartão). O que interessa
  // ao diagnóstico é se o formato normalizou, não o valor.
  console.log(
    "[Cielo:Credit] ExpirationDate formato ok:",
    /^\d{2}\/\d{4}$/.test(normalizeExpiration(params.cardExpiration)),
  );

  const res = await fetch(`${BASE_URL}/1/sales/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    // A resposta de erro da Cielo pode ecoar campos do que foi enviado.
    console.error("[Cielo:Credit] Error:", JSON.stringify(redact(data)));
    const errors = Array.isArray(data) ? data : [data];
    const errorMsg = errors.map((e: Record<string, unknown>) => (e.Message as string) || (e.message as string) || JSON.stringify(e)).join(", ");
    throw new Error(`Cielo: ${errorMsg}`);
  }

  return {
    paymentId: data.Payment?.PaymentId as string,
    status: data.Payment?.Status as number,
    returnCode: data.Payment?.ReturnCode as string,
    returnMessage: data.Payment?.ReturnMessage as string,
    mensagemAmigavel: mensagemRecusa(data.Payment?.ReturnCode),
    approved: data.Payment?.Status === 2,
  };
}

/**
 * Consulta de detalhe da venda.
 *
 * O POST de notificação da Cielo carrega apenas `PaymentId` e `ChangeType` — o
 * `MerchantOrderId` NÃO vem no corpo. Ele existe na resposta desta consulta, no
 * nível raiz, e é o que liga o pagamento ao draft. Por isso o campo passou a ser
 * devolvido aqui: sem ele o webhook não tem como correlacionar.
 *
 * Timeout de 8s e no máximo 2 tentativas — o webhook não pode ficar pendurado
 * numa consulta lenta, e o gateway reentrega se respondermos erro.
 */
export async function getPaymentStatus(paymentId: string): Promise<{
  paymentId: string;
  status: number;
  merchantOrderId?: string;
  httpStatus?: number;
}> {
  const MAX_TENTATIVAS = 2;
  const TIMEOUT_MS = 8000;
  let ultimoErro: unknown = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${QUERY_URL}/1/sales/${paymentId}`, {
        headers: getHeaders(),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      return {
        paymentId,
        status: data.Payment?.Status as number,
        merchantOrderId: (data.MerchantOrderId ?? data.Payment?.MerchantOrderId) as string | undefined,
        httpStatus: res.status,
      };
    } catch (err) {
      ultimoErro = err;
      console.warn(
        `[Cielo:getPaymentStatus] tentativa ${tentativa}/${MAX_TENTATIVAS} falhou:`,
        (err as Error)?.message,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  console.error("[Cielo:getPaymentStatus] consulta falhou:", (ultimoErro as Error)?.message);
  return { paymentId, status: NaN };
}

function normalizeExpiration(exp: string): string {
  const clean = exp.replace(/[^\d/]/g, "");
  const parts = clean.split("/");
  if (parts.length !== 2) return exp;
  const [month, year] = parts;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${month.padStart(2, "0")}/${fullYear}`;
}

function detectBrand(cardNumber: string): string {
  const n = cardNumber.replace(/\s/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n)) return "Master";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6(?:011|5)/.test(n)) return "Discover";
  return "Visa";
}
