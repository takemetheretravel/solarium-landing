import { NextResponse } from "next/server";
import { createBraspagSaleSimulado } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota de validação de conexão com o gateway Braspag (sandbox, Provider Simulado).
// Protegida: só responde se o header x-braspag-test bater com o MerchantId configurado.
// NÃO faz parte do fluxo de pagamento real — serve apenas para confirmar credenciais.
export async function POST(req: Request) {
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
