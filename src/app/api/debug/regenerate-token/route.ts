import { NextResponse } from "next/server";
import { clearTokenCache } from "@/lib/hostaway";
import { tokenAdminValido, naoEncontrado } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Header: Authorization: Bearer <ADMIN_API_TOKEN>
// Responde JSON. O redirect de antes servia à página /debug/hostaway, que saiu,
// e aceitava destino arbitrário vindo do formulário.
export async function POST(req: Request) {
  if (!tokenAdminValido(req)) return naoEncontrado();
  clearTokenCache();
  return NextResponse.json({ ok: true });
}
