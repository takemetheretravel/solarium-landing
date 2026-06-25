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
