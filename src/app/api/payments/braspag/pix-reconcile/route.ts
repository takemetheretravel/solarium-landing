import { NextResponse } from "next/server";
import { scanAllDrafts } from "@/lib/kv-store";
import { confirmBraspagPixIfPaid } from "@/lib/braspag-pix-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// =============================================================================
// RECONCILIAÇÃO de Pix Braspag — fallback de segurança do webhook.
// A própria doc da Braspag recomenda: "é necessário fazer a consulta (sondagem)
// das transações pendentes (não pagas) que ainda não tenham sido atualizadas".
// Se o webhook falhar em produção, nenhuma reserva paga fica perdida.
//
// COMO ACIONAR:
//   GET /api/payments/braspag/pix-reconcile
//   Header: x-reconcile-secret: <valor de BRASPAG_RECONCILE_SECRET>
//   (ou query ?secret=<valor>)
// Sugestão: agendar via Vercel Cron (vercel.json) a cada 15min, ou acionar
// manualmente ao investigar um Pix "pago mas sem reserva".
//
// Janela: o TTL do draft no Redis é 2h, então o SCAN cobre todos os drafts
// vivos (não existe draft com mais de 2h — janela de 24h é coberta por
// construção; Pix expirado além do TTL exige tratamento manual via painel).
//
// VALIDAR EM PRODUÇÃO: em sandbox o Pix nunca vira pago, então o reconcile
// sempre reportará "pending" — o caminho só confirma de verdade em produção.
// =============================================================================
export async function GET(req: Request) {
  const secret = process.env.BRASPAG_RECONCILE_SECRET || "";
  if (!secret) {
    // Sem segredo configurado, o endpoint não opera (nunca deixar aberto).
    return NextResponse.json({ error: "BRASPAG_RECONCILE_SECRET não configurado" }, { status: 503 });
  }
  const provided =
    req.headers.get("x-reconcile-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const drafts = await scanAllDrafts();
    // Candidatos: Pix Braspag pendente com cobrança gerada.
    const candidates = drafts.filter(
      (d) => d.paymentMethod === "pix" && d.status === "pending" && !!d.braspagPaymentId,
    );

    const results: Array<{ draftId: string; result: string }> = [];
    for (const d of candidates) {
      try {
        const r = await confirmBraspagPixIfPaid(d.id);
        results.push({ draftId: d.id, result: r.status });
        if (r.status === "paid") {
          console.log("[Braspag:pix-reconcile] ✅ Pix confirmado via reconciliação:", d.id);
        }
      } catch (err) {
        console.error("[Braspag:pix-reconcile] erro no draft", d.id, err);
        results.push({ draftId: d.id, result: "error" });
      }
    }

    console.log(
      "[Braspag:pix-reconcile] varridos=%d candidatos=%d pagos=%d",
      drafts.length,
      candidates.length,
      results.filter((r) => r.result === "paid").length,
    );
    return NextResponse.json({
      scanned: drafts.length,
      candidates: candidates.length,
      results,
    });
  } catch (err) {
    console.error("[Braspag:pix-reconcile] Exception:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
