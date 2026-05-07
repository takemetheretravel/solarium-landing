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
    console.error("[Cielo:Pix] Error:", JSON.stringify(data));
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

  console.log("[Cielo:Credit] ExpirationDate enviado:", normalizeExpiration(params.cardExpiration));

  const res = await fetch(`${BASE_URL}/1/sales/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("[Cielo:Credit] Error:", JSON.stringify(data));
    const errors = Array.isArray(data) ? data : [data];
    const errorMsg = errors.map((e: Record<string, unknown>) => (e.Message as string) || (e.message as string) || JSON.stringify(e)).join(", ");
    throw new Error(`Cielo: ${errorMsg}`);
  }

  return {
    paymentId: data.Payment?.PaymentId as string,
    status: data.Payment?.Status as number,
    returnCode: data.Payment?.ReturnCode as string,
    returnMessage: data.Payment?.ReturnMessage as string,
    approved: data.Payment?.Status === 2,
  };
}

export async function getPaymentStatus(paymentId: string) {
  const res = await fetch(`${QUERY_URL}/1/sales/${paymentId}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  return {
    paymentId,
    status: data.Payment?.Status as number,
  };
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
