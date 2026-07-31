import { NextResponse } from "next/server";
import { readAuthLog } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Leitura dos últimos resultados de autorização Braspag persistidos no KV
// (diagnóstico sem depender dos logs da Vercel). Protegido por segredo:
//   GET /api/payments/braspag/authlog?secret=<BRASPAG_RECONCILE_SECRET>
// 404 se o segredo não bater (ou não estiver configurado). Mais recente primeiro.
// Não expõe PAN/CVV/validade — só o que já foi persistido (BIN/últimos 4).
export async function GET(req: Request) {
  const secret = process.env.BRASPAG_RECONCILE_SECRET || "";
  const provided = new URL(req.url).searchParams.get("secret") || "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const entries = await readAuthLog();
  return NextResponse.json({ count: entries.length, entries });
}
