import { NextResponse } from "next/server";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";
import { getDraft } from "@/lib/kv-store";
import { barrarSeEmAnalise } from "@/lib/bloqueio-analise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polling do checkout (provider=braspag). Mesmo contrato da rota Cielo
// (/api/payments/pix/status): { status: paid|pending|failed|expired, redirectTo? }.
// A confirmação (reconsulta + reserva) é o helper compartilhado — idempotente.
// VALIDAR EM PRODUÇÃO: em sandbox o Pix nunca vira "paid".
export async function GET(req: Request) {
  const draftId = new URL(req.url).searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ status: "error" });

  try {
    const draft = await getDraft(draftId);
    if (draft) {
      const bloqueioAnalise = await barrarSeEmAnalise(draft, draftId, "/api/payments/braspag/pix/status");
      if (bloqueioAnalise) return bloqueioAnalise;
    }
    const result = await confirmPixPaymentIfPaid(draftId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/payments/braspag/pix/status] Exception:", err);
    return NextResponse.json({ status: "pending" });
  }
}
