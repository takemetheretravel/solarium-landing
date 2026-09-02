import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-auth";
import { cancelHostawayReservation } from "@/lib/hostaway";
import { removerFinalizacaoHostaway } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Limpeza da simulação: cancela a reserva de ensaio e a tira da fila.
 *
 * Mesmo token da rota que cria. Deixar a criação protegida e a limpeza aberta
 * seria dar a estranhos o poder de cancelar reservas pelo número.
 *
 * A Hostaway não expõe DELETE de reserva — o cancelamento é um PUT de status.
 * A rota se chama DELETE porque é essa a intenção de quem chama.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { reservationId: string } },
) {
  const negado = exigirAdmin(req);
  if (negado) return negado;

  const id = Number(params.reservationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "reservationId inválido" }, { status: 400 });
  }

  const r = await cancelHostawayReservation(id);

  // Sai da fila de marcação de pagamento junto: uma reserva cancelada que
  // continuasse enfileirada geraria tentativas de cobrança para sempre, até
  // esgotar o backoff e escalar — ruído puro no diagnóstico.
  await removerFinalizacaoHostaway(id);

  return NextResponse.json(
    {
      ok: r.ok,
      reservationId: id,
      httpStatus: r.httpStatus,
      respostaCrua: r.corpo,
      filaLimpa: true,
    },
    { status: r.ok ? 200 : 502 },
  );
}
