import { NextResponse } from "next/server";
import { getBraspag3dsAccessToken, Braspag3dsAuthError } from "@/lib/braspag";

// EstablishmentCode usado (não é segredo) — exibido na página para conferência.
function establishmentCodeForDisplay(): string | undefined {
  const code = (process.env.BRASPAG_3DS_ESTABLISHMENT_CODE || "").trim();
  return code || undefined;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sessão 3DS — rota do FLUXO REAL (não é rota de teste): o módulo compartilhado
// braspag-3ds-client a usa no checkout para obter o access token do MPI, em
// sandbox E em produção. As URLs do MPI derivam de BRASPAG_ENVIRONMENT no lib.
// Retorna APENAS o access token do MPI (destinado ao cliente, vai na classe
// bpmpi_accesstoken). NUNCA retorna ClientId/ClientSecret.
export async function POST() {
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
