import { NextResponse } from "next/server";
import { createBraspagPixPayment } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Camada 3 — Cria cobrança Pix de TESTE. Customer de teste fixo (Pix exige CPF).
// Guarda: indisponível em produção.
export async function POST(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const { orderId, amount } = (await req.json()) || {};
    if (!orderId || !amount) {
      return NextResponse.json({ error: "Campos obrigatórios: orderId, amount" }, { status: 400 });
    }

    const result = await createBraspagPixPayment({
      orderId: String(orderId),
      amount: Number(amount),
      customer: { name: "Teste Solarium", identity: "12345678909" },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Braspag:pix-test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
