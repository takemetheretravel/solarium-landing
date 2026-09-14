import { NextResponse } from "next/server";
import { readAuthLog } from "@/lib/kv-store";
import { tokenAdminValido, naoEncontrado } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Leitura dos últimos resultados de autorização Braspag persistidos no KV
// (diagnóstico sem depender dos logs da Vercel).
//   GET /api/payments/braspag/authlog
//   Header: Authorization: Bearer <ADMIN_API_TOKEN>
// Segredo por query string não é mais aceito. 404 sem token válido.
// Mais recente primeiro. Não expõe PAN/CVV/validade — só o que já foi
// persistido (BIN/últimos 4).
export async function GET(req: Request) {
  if (!tokenAdminValido(req)) return naoEncontrado();

  const entries = await readAuthLog();
  return NextResponse.json({ count: entries.length, entries });
}
