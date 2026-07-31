import { NextResponse } from "next/server";
import { consultBraspagPayment } from "@/lib/braspag";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Webhook Braspag — notificação de mudança de status (doc "Post de Notificação").
// Payload documentado: { PaymentId: GUID, ChangeType: número, RecurrentPaymentId? }.
// ChangeType 1 = mudança de status do pagamento (o que nos interessa p/ Pix).
//
// SEGURANÇA: a doc NÃO especifica assinatura/validação de origem para este post.
// TODO: se a Braspag disponibilizar assinatura/allowlist de IP, implementar aqui.
// Mitigação: NUNCA confiamos no payload — o PaymentId recebido é apenas um
// gatilho; o status real vem de uma RECONSULTA server-side autenticada
// (consultBraspagPayment, com MerchantId/MerchantKey), e o draftId vem do
// MerchantOrderId retornado pela PRÓPRIA consulta (não do payload). Um payload
// forjado no máximo dispara uma consulta inócua.
//
// IDEMPOTÊNCIA: delegada ao confirmPixPaymentIfPaid (draft já pago + reserva
// criada = no-op, retorna 200 sem efeito).
//
// Respondemos 200 mesmo em casos ignorados para não gerar retries infinitos;
// 500 apenas em erro interno real (aí o retry da Braspag é desejável).
//
// VALIDAR EM PRODUÇÃO: em sandbox o webhook nunca dispara (Pix não muda de
// status). Por isso o LOG é detalhado — será a fonte de verdade na produção.
// =============================================================================
export async function POST(req: Request) {
  let payload: { PaymentId?: string; ChangeType?: number; RecurrentPaymentId?: string } = {};
  try {
    payload = await req.json().catch(() => ({}));
    console.log("[Webhook:Braspag] notificação recebida:", JSON.stringify(payload));

    const { PaymentId, ChangeType } = payload;

    // Só mudança de status de pagamento nos interessa (Pix). Demais tipos: 200.
    if (!PaymentId || (ChangeType !== undefined && ChangeType !== 1)) {
      console.log("[Webhook:Braspag] ignorado (sem PaymentId ou ChangeType != 1).");
      return NextResponse.json({ ok: true, ignored: true });
    }

    // RECONSULTA server-side — única fonte de verdade (nunca o payload).
    const consult = await consultBraspagPayment(String(PaymentId));
    const raw = (consult.raw ?? {}) as Record<string, unknown>;
    const merchantOrderId = raw.MerchantOrderId as string | undefined;
    console.log(
      "[Webhook:Braspag] reconsulta: paymentId=%s status=%s merchantOrderId=%s",
      PaymentId,
      String(consult.statusCode ?? "-"),
      merchantOrderId ?? "-",
    );

    if (!merchantOrderId) {
      // Pagamento não encontrado/sem pedido — nada a fazer (200 p/ não re-tentar).
      console.warn("[Webhook:Braspag] MerchantOrderId ausente na consulta — sem ação.");
      return NextResponse.json({ ok: true, ignored: true });
    }

    // MerchantOrderId = draftId (é assim que criamos a cobrança).
    const result = await confirmPixPaymentIfPaid(merchantOrderId);
    console.log("[Webhook:Braspag] resultado da confirmação:", JSON.stringify({ draftId: merchantOrderId, result }));

    return NextResponse.json({ ok: true, result: result.status });
  } catch (err) {
    console.error("[Webhook:Braspag] erro:", err, "payload:", JSON.stringify(payload));
    // 500 → a Braspag re-tenta a notificação (comportamento desejado em falha).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
