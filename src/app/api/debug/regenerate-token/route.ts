import { NextRequest, NextResponse } from "next/server";
import { clearTokenCache } from "@/lib/hostaway";
import { exigirAdminForaDeProducao } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Era `?key=lucas2026` em repo público — e esta rota derruba o token de acesso
  // da Hostaway de PRODUÇÃO, forçando reemissão. Agora exige ADMIN_API_TOKEN.
  const negado = exigirAdminForaDeProducao(req);
  if (negado) return negado;

  const form = await req.formData();
  const redirect = String(form.get("redirect") || "/");
  clearTokenCache();
  return NextResponse.redirect(new URL(redirect, req.url), { status: 303 });
}
