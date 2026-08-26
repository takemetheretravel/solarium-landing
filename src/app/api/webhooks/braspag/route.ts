import { NextResponse } from "next/server";
import { consultBraspagPayment } from "@/lib/braspag";
import { confirmPixPaymentIfPaid } from "@/lib/braspag-pix-confirm";
import {
  getDraft,
  draftIdDeOrderId,
  insertWebhookEvent,
  markWebhookEventProcessed,
  deleteWebhookEvent,
  getPaymentIndex,
  pushReconciliationPending,
} from "@/lib/kv-store";

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
  let eventoParaLiberar: { paymentId: string; changeType: string | number } | null = null;
  try {
    payload = await req.json().catch(() => ({}));
    console.log("[Webhook:Braspag] notificação recebida:", JSON.stringify(payload));

    const { PaymentId, ChangeType } = payload;

    // Só mudança de status de pagamento nos interessa (Pix). Demais tipos: 200.
    if (!PaymentId || (ChangeType !== undefined && ChangeType !== 1)) {
      console.log("[Webhook:Braspag] ignorado (sem PaymentId ou ChangeType != 1).");
      return NextResponse.json({ ok: true, ignored: true });
    }

    // IDEMPOTÊNCIA: registro único por (payment_id, change_type) em
    // webhook_events. A janela é de 30 dias — reentrega tardia (houve caso de
    // 109 minutos) continua sendo duplicata. Em erro, o registro é apagado no
    // catch para que o retry legítimo reprocesse.
    const { inserted } = await insertWebhookEvent({
      paymentId: String(PaymentId),
      changeType: ChangeType ?? "none",
      source: "braspag",
    });
    if (!inserted) {
      console.log("[Webhook:Braspag] duplicate ignored", PaymentId);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    eventoParaLiberar = { paymentId: String(PaymentId), changeType: ChangeType ?? "none" };

    const finalizar = async (resposta: Record<string, unknown>) => {
      await markWebhookEventProcessed(String(PaymentId), ChangeType ?? "none");
      eventoParaLiberar = null;
      return NextResponse.json(resposta);
    };

    // RECONSULTA server-side — única fonte de verdade (nunca o payload).
    // A correlação tem dois degraus: o índice local gravado na autorização
    // (não depende de rede) e, sem ele, o MerchantOrderId da reconsulta.
    const indice = await getPaymentIndex(String(PaymentId));
    const consult = await consultBraspagPayment(String(PaymentId));
    const raw = (consult.raw ?? {}) as Record<string, unknown>;
    const merchantOrderId = indice?.merchant_order_id || (raw.MerchantOrderId as string | undefined);
    console.log(
      "[Webhook:Braspag] reconsulta: paymentId=%s status=%s merchantOrderId=%s via=%s",
      PaymentId,
      String(consult.statusCode ?? "-"),
      merchantOrderId ?? "-",
      indice ? "payment_index" : "consulta-detalhe",
    );

    if (!merchantOrderId) {
      // Nenhum caminho resolveu. 200 p/ não gerar reentrega infinita, mas o
      // evento fica registrado como pendência — nunca some em silêncio.
      console.error(
        "[Webhook:Braspag] correlação falhou " + JSON.stringify({ payment_id: PaymentId, change_type: ChangeType }),
      );
      await pushReconciliationPending({
        payment_id: String(PaymentId),
        change_type: String(ChangeType ?? "none"),
        source: "braspag",
        reason: "merchant_order_id não resolvido (índice local e reconsulta vazios)",
      });
      return finalizar({ ok: true, pendingReconciliation: true });
    }

    // MerchantOrderId = draftId. Identifica o MÉTODO antes de qualquer confirmação.
    const draft = await getDraft(indice?.draft_id || draftIdDeOrderId(merchantOrderId));
    if (!draft) {
      console.error("[Webhook:Braspag] draft não encontrado p/ merchantOrderId:", merchantOrderId);
      await pushReconciliationPending({
        payment_id: String(PaymentId),
        change_type: String(ChangeType ?? "none"),
        source: "braspag",
        reason: `draft não encontrado (expirado?) para merchant_order_id ${merchantOrderId}`,
      });
      return finalizar({ ok: true, pendingReconciliation: true });
    }

    // Item 1: CARTÃO é resolvido SINCRONAMENTE no /credit → só loga e retorna 200.
    if (draft.paymentMethod === "card") {
      console.log("[Webhook:Braspag] método=card — resolvido sincronamente no /credit; sem ação. draftId:", merchantOrderId);
      return finalizar({ ok: true, method: "card", ignored: true });
    }

    // Itens 2/4: Pix já reservado = notificação tardia da mesma transação → 200.
    if (typeof draft.hostawayReservationId === "number" && draft.hostawayReservationId > 0) {
      console.log("[Webhook:Braspag] Pix já reservado — notificação tardia; sem ação. draftId:", merchantOrderId);
      return finalizar({ ok: true, method: "pix", alreadyReserved: true });
    }

    // Item 2: só Pix pendente (não reservado) dispara a confirmação assíncrona.
    const result = await confirmPixPaymentIfPaid(merchantOrderId);
    console.log("[Webhook:Braspag] método=pix resultado:", JSON.stringify({ draftId: merchantOrderId, result }));

    return finalizar({ ok: true, method: "pix", result: result.status });
  } catch (err) {
    console.error("[Webhook:Braspag] erro:", err, "payload:", JSON.stringify(payload));
    // Libera o registro do evento p/ a Braspag reprocessar no retry.
    if (eventoParaLiberar) {
      await deleteWebhookEvent(eventoParaLiberar.paymentId, eventoParaLiberar.changeType);
    }
    // 500 → a Braspag re-tenta a notificação (comportamento desejado em falha).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
