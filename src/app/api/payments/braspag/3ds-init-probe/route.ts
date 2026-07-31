import { NextResponse } from "next/server";
import { getBraspag3dsAccessToken, BRASPAG_URLS } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Probe SERVER-SIDE do /v2/3ds/init — elimina o navegador/SDK da equação.
// Emite um token FRESCO e imediatamente chama o init com Bearer, para verificar
// se o 401 (Code 600 "Invalid Access Token") acontece também fora do browser.
// Experimento A: ?origin=<url> adiciona o header Origin na chamada ao init,
// simulando a única diferença de header relevante do navegador.
// Guarda: indisponível em produção. NUNCA retorna o token em si.
export async function GET(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const origin = new URL(req.url).searchParams.get("origin");

    // (1) token fresco
    const t0 = Date.now();
    const token = await getBraspag3dsAccessToken();

    // (2) init imediato
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Script-Version": "0.0.1",
    };
    if (origin) headers.Origin = origin;

    const res = await fetch(`${BRASPAG_URLS.mpi3ds}/v2/3ds/init`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        orderNumber: `probe-${Date.now()}`,
        currency: "BRL",
        amount: "1000",
      }),
    });

    const elapsedMs = Date.now() - t0;
    const raw = await res.text();
    let initBody: unknown;
    try {
      initBody = JSON.parse(raw);
    } catch {
      initBody = raw;
    }

    // (3) resultado (sem expor o token)
    return NextResponse.json({
      tokenObtained: true,
      initStatus: res.status,
      initBody,
      tokenLen: token.length,
      elapsedMs,
      originSent: origin || null,
    });
  } catch (err) {
    console.error("[Braspag:3ds-init-probe] erro:", err);
    return NextResponse.json(
      { tokenObtained: false, error: (err as Error)?.message || "erro" },
      { status: 500 },
    );
  }
}
