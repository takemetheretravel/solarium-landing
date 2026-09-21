import { NextResponse } from "next/server";
import { naoEncontrado, tokenAdminValido } from "@/lib/admin-auth";
import { lerViolacoesCsp } from "@/lib/kv-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Violações da CSP report-only da página de pagamento (rodada PAG1b). Só leitura.
//   GET /api/admin/csp
//   Header: Authorization: Bearer <ADMIN_API_TOKEN>
// 404 sem token ou com token errado, como as demais rotas admin.
// Devolve contagem por diretiva, por origem bloqueada e as 50 mais recentes —
// já higienizadas na entrada (sem path, query, trecho de código ou draftId).
export async function GET(req: Request) {
  if (!tokenAdminValido(req)) return naoEncontrado();
  try {
    return NextResponse.json(await lerViolacoesCsp());
  } catch (err) {
    console.error("[/api/admin/csp] erro:", err);
    return NextResponse.json({ error: "falha ao ler o KV" }, { status: 500 });
  }
}
