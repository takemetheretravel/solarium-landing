import { NextResponse } from "next/server";
import { getPaymentProviderSafe } from "@/config/payment-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expõe a flag PAYMENT_PROVIDER ao cliente (não é segredo). A página de
// pagamento decide o caminho (cielo vs braspag). NÃO há default: ambiente sem a
// variável responde 503 com o motivo, em vez de escolher gateway em silêncio.
// `sandbox` habilita o checkbox de teste do caminho Braspag; em produção vem
// false e o checkbox nem renderiza.
export async function GET() {
  const r = getPaymentProviderSafe();
  if (!r.ok) {
    console.error("[provider]", r.erro);
    return NextResponse.json({ error: r.erro, provider: null }, { status: 503 });
  }
  return NextResponse.json({
    provider: r.provider,
    sandbox: process.env.BRASPAG_ENVIRONMENT !== "production",
  });
}
