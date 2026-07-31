import { NextResponse } from "next/server";
import { captureBraspagPayment } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1C — Captura SEPARADA de teste (PUT /v2/sales/{id}/capture).
// Usada apenas pela página braspag-3ds-test.
// Guarda: indisponível em produção.
export async function POST(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const { paymentId, amount } = (await req.json()) || {};
    if (!paymentId || !amount) {
      return NextResponse.json({ error: "Campos obrigatórios: paymentId, amount" }, { status: 400 });
    }

    const result = await captureBraspagPayment(String(paymentId), Number(amount));
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Braspag:capture-test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
