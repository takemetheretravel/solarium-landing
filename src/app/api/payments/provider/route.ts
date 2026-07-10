import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/config/payment-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expõe a flag PAYMENT_PROVIDER ao cliente (não é segredo). A página de
// pagamento decide o caminho (cielo vs braspag). Default = "cielo".
export async function GET() {
  return NextResponse.json({ provider: getPaymentProvider() });
}
