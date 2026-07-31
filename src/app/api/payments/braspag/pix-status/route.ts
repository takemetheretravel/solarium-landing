import { NextResponse } from "next/server";
import { consultBraspagPayment } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Camada 3 — Consulta status de um Pix (confirmação assíncrona).
// Guarda: indisponível em produção.
export async function GET(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const paymentId = new URL(req.url).searchParams.get("paymentId");
    if (!paymentId) {
      return NextResponse.json({ error: "Param obrigatório: paymentId" }, { status: 400 });
    }

    const result = await consultBraspagPayment(paymentId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Braspag:pix-status] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
