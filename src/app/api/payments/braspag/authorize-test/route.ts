import { NextResponse } from "next/server";
import { createBraspagAuthorization } from "@/lib/braspag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endereço de cobrança/entrega de TESTE (antifraude exige endereço completo).
const TEST_ADDRESS = {
  Street: "Rua das Flores",
  Number: "100",
  Complement: "Casa",
  ZipCode: "37464000",
  City: "Itanhandu",
  State: "MG",
  Country: "BRA",
  District: "Centro",
};

// 2B — Autorização de TESTE com ExternalAuthentication (3DS) + Antifraude
// Cybersource. Usada apenas pela página braspag-3ds-test. Customer/endereço de
// teste fixos. Guarda: indisponível em produção. NUNCA logar número de cartão.
export async function POST(req: Request) {
  if (process.env.BRASPAG_ENVIRONMENT === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { orderId, amount, installments, card, externalAuthentication, browserFingerprint } =
      body || {};

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

    // O antifraude depende do fingerprint — não silenciar se ausente.
    if (!browserFingerprint || String(browserFingerprint).trim() === "") {
      return NextResponse.json(
        { error: "browserFingerprint (ProviderIdentifier da Camada 2A) é obrigatório para a análise antifraude." },
        { status: 400 },
      );
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    console.log(
      "[Braspag:authorize-test] order=%s amount=%d card=****%s fp=%s",
      orderId,
      amount,
      String(card.number).slice(-4),
      String(browserFingerprint).slice(0, 8) + "…",
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
        phone: "5535999990000",
        birthdate: "1990-01-01",
        billingAddress: TEST_ADDRESS,
        deliveryAddress: TEST_ADDRESS,
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
      fraud: {
        browserFingerprint: String(browserFingerprint),
        hostName: req.headers.get("host") || "",
        cartItems: [
          {
            name: "Hospedagem Solarium (teste)",
            quantity: 1,
            sku: "SOL-HOSP-TEST",
            unitPrice: Number(amount),
            risk: "Normal",
            type: "Default",
          },
        ],
        // MDDs (MerchantDefinedFields) são configurados por lojista na Cybersource.
        // Valores de teste ilustrativos p/ o ramo de hospedagem (7011) — ajustar
        // conforme o mapa de MDDs cadastrado na conta.
        merchantDefinedFields: [
          { Id: 2, Value: "hospedagem" },
          { Id: 4, Value: "reserva-direta" },
        ],
        shipping: { method: "None" }, // hospedagem não tem entrega física
      },
    });

    // Eco de validação (sem HAR): caminho exato + valor do fingerprint enviado.
    return NextResponse.json({
      ...result,
      fingerprintField: "Payment.FraudAnalysis.FingerPrintId",
      fingerprintValue: String(browserFingerprint),
    });
  } catch (err) {
    console.error("[Braspag:authorize-test] erro:", err);
    return NextResponse.json({ error: (err as Error)?.message || "erro" }, { status: 500 });
  }
}
