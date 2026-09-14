import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

// Porta única das rotas administrativas e de diagnóstico (rodada S1).
//   Header: Authorization: Bearer <ADMIN_API_TOKEN>
// Token só por header — em query string ele vazaria para log de acesso,
// histórico do navegador e Referer.
// Sem ADMIN_API_TOKEN no ambiente a rota fica FECHADA, nunca permissiva.
export function tokenAdminValido(req: Request): boolean {
  const token = (process.env.ADMIN_API_TOKEN || "").trim();
  if (!token) return false;
  const header = req.headers.get("authorization") || "";
  const recebido = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 404 e não 401/403: rota administrativa não confirma a própria existência.
export function naoEncontrado() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
