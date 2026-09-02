import { NextResponse } from "next/server";
import { getChannels } from "@/lib/hostaway";
import { exigirAdminForaDeProducao } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Era `?key=lucas2026`, com a chave escrita neste arquivo, em repo público.
  const negado = exigirAdminForaDeProducao(req);
  if (negado) return negado;

  const channels = await getChannels();
  return NextResponse.json({ channels });
}
