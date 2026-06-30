import { NextResponse } from "next/server";
import { getBraspag3dsAccessToken, Braspag3dsAuthError } from "@/lib/braspag";

// EstablishmentCode usado (não é segredo) — exibido na página para conferência.
function establishmentCodeForDisplay(): string | undefined {
  const code = (process.env.BRASPAG_3DS_ESTABLISHMENT_CODE || "").trim();
  return code || undefined;
}

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

  const establishmentCode = establishmentCodeForDisplay();
  try {
    const accessToken = await getBraspag3dsAccessToken();
    return NextResponse.json({ accessToken, establishmentCode });
  } catch (err) {
    console.error("[Braspag:3ds-session] erro:", err);
    // Propaga status + corpo exato do MPI (não contém segredos nossos) para
    // diagnóstico do MPI900/401 no cliente. establishmentCode não é segredo.
    if (err instanceof Braspag3dsAuthError) {
      return NextResponse.json(
        { error: err.message, mpiStatus: err.status, mpiBody: err.mpiBody, establishmentCode },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: (err as Error)?.message || "erro", establishmentCode },
      { status: 500 },
    );
  }
}
