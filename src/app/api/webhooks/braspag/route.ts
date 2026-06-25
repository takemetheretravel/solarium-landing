import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stub de webhook da Braspag — coexiste com /api/webhooks/cielo, não o substitui.
// Por ora apenas loga o body recebido e responde 200. A lógica de confirmação
// de reserva entra numa etapa posterior, quando a flag PAYMENT_PROVIDER=braspag.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    console.log("[Webhook:Braspag]", JSON.stringify(body));
  } catch (err) {
    console.error("[Webhook:Braspag] erro ao ler body:", err);
  }
  return NextResponse.json({ ok: true });
}
