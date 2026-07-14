import { NextResponse } from "next/server";
import { voidBraspagPayment, consultBraspagPayment } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nome do status pós-void, conforme a Lista de Status da Transação (doc):
// 10 = Voided (cancelamento de autorização/captura no mesmo dia — libera limite)
// 11 = Refunded (estorno de transação já capturada — devolve o valor cobrado)
function statusName(code?: number): string {
  switch (code) {
    case 10: return "Voided (cancelado — limite liberado)";
    case 11: return "Refunded (estornado — valor devolvido)";
    case 2: return "PaymentConfirmed";
    case 1: return "Authorized";
    case 3: return "Denied";
    case 12: return "Pending";
    case 13: return "Aborted";
    default: return code === undefined ? "—" : `código ${code}`;
  }
}

// Cancelamento/estorno de TESTE (homologação). Guarda: indisponível em produção.
// Sem amount = void TOTAL.
export async function POST(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const { paymentId, amount } = (await req.json()) || {};
    if (!paymentId) {
      return NextResponse.json({ error: "Campo obrigatório: paymentId" }, { status: 400 });
    }

    // Void total quando amount ausente: consulta o valor autorizado/capturado.
    let voidAmount = Number(amount) || 0;
    if (!voidAmount) {
      const consult = await consultBraspagPayment(String(paymentId));
      const payment = ((consult.raw ?? {}) as { Payment?: Record<string, unknown> }).Payment ?? {};
      voidAmount = Number(payment.Amount) || 0;
      if (!voidAmount) {
        return NextResponse.json(
          { error: "amount ausente e não foi possível obter o valor da transação para void total." },
          { status: 400 },
        );
      }
    }

    const result = await voidBraspagPayment(String(paymentId), voidAmount);
    return NextResponse.json({
      status: result.status,
      statusCode: result.statusCode,
      statusName: statusName(result.statusCode),
      returnCode: result.returnCode,
      returnMessage: result.returnMessage,
      amountVoided: voidAmount,
      raw: result.raw,
    });
  } catch (err) {
    console.error("[Braspag:void-test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
