import { NextResponse } from "next/server";
import { createBraspagAuthorization } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1C — Autorização de TESTE com ExternalAuthentication (resultado do 3DS 1B).
// Usada apenas pela página braspag-3ds-test. Customer de teste fixo.
// Guarda: indisponível em produção. NUNCA logar número de cartão completo.
export async function POST(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { orderId, amount, installments, card, externalAuthentication } = body || {};

    if (
      !orderId ||
      !amount ||
      !card?.number ||
      !card?.holder ||
      !card?.expiration ||
      !externalAuthentication?.Cavv
    ) {
      return NextResponse.json(
        { error: "Campos obrigatórios: orderId, amount, card{number,holder,expiration,cvv,brand}, externalAuthentication{Cavv,Xid,Eci,Version,ReferenceId}" },
        { status: 400 },
      );
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    console.log(
      "[Braspag:authorize-test] order=%s amount=%d card=****%s",
      orderId,
      amount,
      String(card.number).slice(-4),
    );

    const result = await createBraspagAuthorization({
      orderId: String(orderId),
      amount: Number(amount),
      installments: Number(installments) || 1,
      customer: {
        name: "Teste Solarium",
        identity: "12345678909",
        email: "teste@solariummantiqueira.com",
        ipAddress,
      },
      card: {
        number: String(card.number),
        holder: String(card.holder),
        expiration: String(card.expiration),
        cvv: String(card.cvv || ""),
        brand: String(card.brand || "Visa"),
      },
      externalAuthentication: {
        Cavv: String(externalAuthentication.Cavv || ""),
        Xid: String(externalAuthentication.Xid || ""),
        Eci: String(externalAuthentication.Eci || ""),
        Version: String(externalAuthentication.Version || ""),
        ReferenceId: String(externalAuthentication.ReferenceId || ""),
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Braspag:authorize-test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
