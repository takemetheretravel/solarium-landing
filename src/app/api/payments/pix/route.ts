import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { createPixPayment } from "@/lib/cielo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { draftId } = (await req.json()) as { draftId?: string };
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });
    if (draft.paymentMethod !== "pix") return NextResponse.json({ error: "Método inválido" }, { status: 400 });

    const amountCents = Math.round(draft.finalTotal * 100);

    const pix = await createPixPayment({
      orderId: draftId,
      amount: amountCents,
      customerName: `${draft.guestFirstName} ${draft.guestLastName}`,
      customerCpf: draft.guestCpf,
      customerEmail: draft.guestEmail,
    });

    await updateDraft(draftId, { cieloPaymentId: pix.paymentId, status: "pending" });

    return NextResponse.json({
      paymentId: pix.paymentId,
      qrCodeBase64: pix.qrCodeBase64,
      qrCodeString: pix.qrCodeString,
      expiresAt: pix.expiresAt,
      amount: draft.finalTotal,
    });
  } catch (err) {
    console.error("[/api/payments/pix]", err);
    return NextResponse.json({ error: "Erro ao gerar Pix" }, { status: 500 });
  }
}
