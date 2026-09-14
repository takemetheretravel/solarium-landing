import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { lerObservabilidadeAntifraude } from "@/lib/kv-store";
import { reconciliarPagamentoEmAnalise } from "@/lib/reconciliacao-analise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Observabilidade do antifraude (rodada A1). Só leitura, sem página.
//   GET /api/admin/antifraude
//   Header: Authorization: Bearer <ADMIN_API_TOKEN>
// Token só por header — em query string ele vazaria para log de acesso.
// 404 quando o token falta ou não bate, para não anunciar a rota.
//
// Devolve contagem por status do antifraude (24h e 7d), webhooks ignorados por
// ChangeType, voids sem sucesso e os registros mais recentes de cada um. Os
// registros já são gravados redigidos (sem PAN, CVV, nome ou e-mail).
function autorizado(req: Request): boolean {
  const token = (process.env.ADMIN_API_TOKEN || "").trim();
  if (!token) return false;
  const header = req.headers.get("authorization") || "";
  const recebido = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    return NextResponse.json(await lerObservabilidadeAntifraude());
  } catch (err) {
    console.error("[/api/admin/antifraude] erro:", err);
    return NextResponse.json({ error: "falha ao ler o KV" }, { status: 500 });
  }
}

// Reconciliação manual do Review (rodada A3) — a rede de segurança para a
// notificação que não chegar.
//   POST /api/admin/antifraude
//   Header: Authorization: Bearer <ADMIN_API_TOKEN>
//   Body:   { "paymentId": "<guid>" }
// Mesmo caminho de código dos webhooks (reconciliarPagamentoEmAnalise), com as
// mesmas travas de idempotência. Pode ser chamada quantas vezes for preciso.
export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { paymentId?: unknown };
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (!/^[0-9a-fA-F-]{36}$/.test(paymentId)) {
    return NextResponse.json({ error: "paymentId (GUID) obrigatório" }, { status: 400 });
  }
  try {
    const resultado = await reconciliarPagamentoEmAnalise(paymentId, "manual");
    console.log("[/api/admin/antifraude] reconciliação manual:", JSON.stringify({ paymentId, resultado }));
    return NextResponse.json({ paymentId, ...resultado });
  } catch (err) {
    console.error("[/api/admin/antifraude] erro na reconciliação manual:", err);
    return NextResponse.json({ error: "falha na reconciliação" }, { status: 500 });
  }
}
