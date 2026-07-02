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
