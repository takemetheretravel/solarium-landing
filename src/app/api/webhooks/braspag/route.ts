import { NextResponse } from "next/server";
import { consultBraspagPayment } from "@/lib/braspag";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";
import { getDraft, claimWebhookEventOnce, releaseWebhookEvent } from "@/lib/kv-store";

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
  let dedupKey: string | null = null;
  try {
    payload = await req.json().catch(() => ({}));
    console.log("[Webhook:Braspag] notificação recebida:", JSON.stringify(payload));

    const { PaymentId, ChangeType } = payload;

    // Só mudança de status de pagamento nos interessa (Pix). Demais tipos: 200.
    if (!PaymentId || (ChangeType !== undefined && ChangeType !== 1)) {
      console.log("[Webhook:Braspag] ignorado (sem PaymentId ou ChangeType != 1).");
      return NextResponse.json({ ok: true, ignored: true });
    }

    // DEDUP (item 3): a mesma notificação chega/reprocessa 2x. Claim atômico por
    // PaymentId+ChangeType; se já visto na janela, ignora (não duplica órfão/log).
    // Em erro, a claim é liberada no catch p/ o retry legítimo reprocessar.
    dedupKey = `${PaymentId}:${ChangeType ?? "?"}`;
    const isNew = await claimWebhookEventOnce(dedupKey);
    if (!isNew) {
      console.log("[Webhook:Braspag] evento duplicado ignorado (dedup):", dedupKey);
      dedupKey = null; // não liberar: a 1ª entrega é a dona
      return NextResponse.json({ ok: true, dedup: true });
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

    // MerchantOrderId = draftId. Identifica o MÉTODO antes de qualquer confirmação.
    const draft = await getDraft(merchantOrderId);
    if (!draft) {
      console.warn("[Webhook:Braspag] draft não encontrado p/ merchantOrderId:", merchantOrderId);
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Item 1: CARTÃO é resolvido SINCRONAMENTE no /credit → só loga e retorna 200.
    if (draft.paymentMethod === "card") {
      console.log("[Webhook:Braspag] método=card — resolvido sincronamente no /credit; sem ação. draftId:", merchantOrderId);
      return NextResponse.json({ ok: true, method: "card", ignored: true });
    }

    // Itens 2/4: Pix já reservado = notificação tardia da mesma transação → 200.
    if (typeof draft.hostawayReservationId === "number" && draft.hostawayReservationId > 0) {
      console.log("[Webhook:Braspag] Pix já reservado — notificação tardia; sem ação. draftId:", merchantOrderId);
      return NextResponse.json({ ok: true, method: "pix", alreadyReserved: true });
    }

    // Item 2: só Pix pendente (não reservado) dispara a confirmação assíncrona.
    const result = await confirmPixPaymentIfPaid(merchantOrderId);
    console.log("[Webhook:Braspag] método=pix resultado:", JSON.stringify({ draftId: merchantOrderId, result }));

    return NextResponse.json({ ok: true, method: "pix", result: result.status });
  } catch (err) {
    console.error("[Webhook:Braspag] erro:", err, "payload:", JSON.stringify(payload));
    // Libera a claim de dedup p/ a Braspag reprocessar este evento no retry.
    if (dedupKey) await releaseWebhookEvent(dedupKey);
    // 500 → a Braspag re-tenta a notificação (comportamento desejado em falha).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
