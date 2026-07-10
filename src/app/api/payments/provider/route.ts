import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/config/payment-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expõe a flag PAYMENT_PROVIDER ao cliente (não é segredo). A página de
// pagamento decide o caminho (cielo vs braspag). Default = "cielo".
// `sandbox` habilita o checkbox de teste do caminho Braspag; em produção vem
// false e o checkbox nem renderiza.
export async function GET() {
  return NextResponse.json({
    provider: getPaymentProvider(),
    sandbox: process.env.BRASPAG_ENVIRONMENT !== "production",
  });
}
