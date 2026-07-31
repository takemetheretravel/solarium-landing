import { NextResponse } from "next/server";
import { createBraspagSaleSimulado, checkBraspagConfig } from "@/lib/braspag";
import { getPaymentProvider } from "@/config/payment-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check público — usado pela equipe Braspag para confirmar que o
// ambiente de staging está acessível. NÃO expõe nenhum segredo: apenas
// booleanos de "configurado/não configurado" + avisos de config (sem valores).
export async function GET() {
  const configWarnings = checkBraspagConfig();
  return NextResponse.json({
    ok: true,
    service: "braspag-gateway",
    env: process.env.BRASPAG_ENVIRONMENT === "production" ? "production" : "sandbox",
    provider: getPaymentProvider(),
    merchantIdConfigured: Boolean(process.env.BRASPAG_MERCHANT_ID),
    merchantKeyConfigured: Boolean(process.env.BRASPAG_MERCHANT_KEY),
    configWarnings, // [] quando ok; avisa se MerchantId não parece GUID
    timestamp: new Date().toISOString(),
  });
}

// Rota de validação de conexão com o gateway Braspag (sandbox, Provider Simulado).
// Protegida: só responde se o header x-braspag-test bater com o MerchantId configurado.
// NÃO faz parte do fluxo de pagamento real — serve apenas para confirmar credenciais.
export async function POST(req: Request) {
  // Smoke test (venda Simulada) — diagnóstico de sandbox. 404 em produção
  // (o GET de health check acima permanece público: só booleanos, sem segredo).
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const merchantId = process.env.BRASPAG_MERCHANT_ID || "";
  const provided = req.headers.get("x-braspag-test") || "";

  if (!merchantId || provided !== merchantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Cartão de teste do Provider Simulado (sem 3DS). No Simulado, o resultado
    // é governado pelo valor; 1000 = R$ 10,00 → autorizado.
    const result = await createBraspagSaleSimulado({
      orderId: `test-${Date.now()}`,
      amount: 1000,
      cardNumber: "4551870000000183",
      holder: "TESTE SOLARIUM",
      expiration: "12/2030",
      cvv: "123",
      brand: "Visa",
      installments: 1,
      customerName: "Teste Solarium",
    });

    return NextResponse.json({ ok: true, gatewayStatus: result.status, gatewayResponse: result.data });
  } catch (err) {
    console.error("[Braspag:test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
