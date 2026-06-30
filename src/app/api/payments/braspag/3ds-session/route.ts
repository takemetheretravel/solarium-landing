import { NextResponse } from "next/server";
import { getBraspag3dsAccessToken } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1B — Sessão 3DS para a página de teste isolada.
// Retorna APENAS o access token do MPI (destinado ao cliente, vai na classe
// bpmpi_accesstoken). NUNCA retorna ClientId/ClientSecret.
// Guarda: indisponível em produção (página de teste não existe em PRD).
export async function POST() {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const accessToken = await getBraspag3dsAccessToken();
    return NextResponse.json({ accessToken });
  } catch (err) {
    console.error("[Braspag:3ds-session] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
