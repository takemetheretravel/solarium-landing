import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { createBraspagPixPayment } from "@/lib/braspag";
import { pixChargeFromDraft } from "@/lib/pix-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pix REAL via Braspag (checkout, provider=braspag). Espelha o contrato da rota
// Cielo (/api/payments/pix): recebe draftId, valor SEMPRE recalculado
// server-side (draft.finalTotal — nunca confiar em valor do cliente), CPF do
// draft. NÃO cria reserva aqui: a reserva só nasce na CONFIRMAÇÃO do pagamento
// (webhook / polling / reconcile → confirmPixPaymentIfPaid).
// VALIDAR EM PRODUÇÃO: em sandbox o Pix nunca muda de status.
export async function POST(req: Request) {
  try {
    const { draftId } = (await req.json()) || {};
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });

    // Reuso: se já existe um Pix gerado para este draft, não gera outra cobrança.
    if (draft.braspagPaymentId && draft.status === "pending") {
      console.log("[Braspag:pix-checkout] draft já tem Pix pendente:", draftId, draft.braspagPaymentId);
    }

    // Valor recalculado SERVER-SIDE aplicando o desconto de Pix (helper único,
    // cent-precise e idempotente) — o QR reflete o valor com desconto que o
    // cliente vê. Não confia em valor do cliente.
    const { subtotalCents, discountCents, totalCents } = pixChargeFromDraft(draft);
    const amountCents = totalCents;
    console.log(
      "[Braspag:pix-checkout] valores " +
        JSON.stringify({
          draftId,
          subtotal: (subtotalCents / 100).toFixed(2),
          pixDiscount: (discountCents / 100).toFixed(2),
          finalCharged: (totalCents / 100).toFixed(2),
        }),
    );

    const result = await createBraspagPixPayment({
      orderId: draftId,
      amount: amountCents,
      customer: {
        name: `${draft.guestFirstName} ${draft.guestLastName}`,
        identity: (draft.guestCpf || "").replace(/\D/g, ""),
      },
    });

    if (result.errorCode !== undefined || !result.paymentId) {
      console.error("[Braspag:pix-checkout] falha ao gerar Pix:", JSON.stringify({ draftId, errorCode: result.errorCode, errorMessage: result.errorMessage, http: result.status }));
      return NextResponse.json(
        { error: result.errorMessage || "Erro ao gerar QR Code Pix." },
        { status: 502 },
      );
    }

    // Guarda o PaymentId no draft: é o elo usado pelo webhook/polling/reconcile.
    await updateDraft(draftId, { braspagPaymentId: result.paymentId });

    // Contrato de resposta espelha a rota Cielo (qrCodeBase64 + qrCodeString).
    return NextResponse.json({
      paymentId: result.paymentId,
      qrCodeBase64: result.qrCodeBase64Image || "",
      qrCodeString: result.qrCodeString || "",
      status: result.statusCode, // esperado 12 = Pending
    });
  } catch (err) {
    console.error("[/api/payments/braspag/pix] Exception:", err);
    return NextResponse.json({ error: "Erro ao gerar QR Code Pix." }, { status: 500 });
  }
}
