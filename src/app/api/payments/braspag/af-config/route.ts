import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Config do FingerPrint Antifraude Cybersource (não são segredos — centralizados
// aqui para não hardcode no cliente). OrgID e ProviderMerchantId vêm de env vars.
// Necessário também no fluxo real (2B), por isso NÃO é gated a sandbox.
export async function GET() {
  return NextResponse.json({
    orgId: process.env.BRASPAG_AF_FINGERPRINT_ORGID || "",
    providerMerchantId: process.env.BRASPAG_AF_PROVIDER_MERCHANT_ID || "",
  });
}
