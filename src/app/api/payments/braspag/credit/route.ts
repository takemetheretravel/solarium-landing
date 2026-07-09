import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import {
  createBraspagAuthorization,
  captureBraspagPayment,
  voidBraspagPayment,
  mensagemRecusaBraspag,
  type BraspagAddress,
} from "@/lib/braspag";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { enviarAlertaRecusa, enviarAlertaAprovacao } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Detecta a bandeira pelo BIN (a Cielo detectava sozinha; a Braspag exige Brand).
function detectCardBrand(num: string): string {
  const n = (num || "").replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "Master";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(606282|3841)/.test(n)) return "Hipercard";
  if (/^(4011|4312|4389|5041|5066|5090|6277|6362|6363|650|651|655)/.test(n)) return "Elo";
  return "Visa"; // fallback conservador
}

// A1 — Fluxo real de crédito via Braspag (3DS + antifraude + captura separada).
// Espelha o contrato/pós-pagamento da rota Cielo (/api/payments/credit) SEM
// tocá-la. Braspag EXIGE 3DS (ExternalAuthentication) e fingerprint (2A).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      draftId?: string;
      cardNumber?: string;
      cardHolder?: string;
      cardExpiration?: string;
      cardCvv?: string;
      installments?: number;
      amountOverride?: number;
      browserFingerprint?: string;
      externalAuthentication?: { Cavv?: string; Xid?: string; Eci?: string; Version?: string; ReferenceId?: string };
      billing?: {
        street?: string;
        number?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        zipCode?: string;
      };
    };
    const {
      draftId,
      cardNumber,
      cardHolder,
      cardExpiration,
      cardCvv,
      installments,
      amountOverride,
      browserFingerprint,
      externalAuthentication,
      billing,
    } = body;

    // ---- Validação de entrada (Braspag exige 3DS + fingerprint) ----
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
    if (!cardNumber || !cardHolder || !cardExpiration || !cardCvv) {
      return NextResponse.json({ error: "Dados do cartão incompletos" }, { status: 400 });
    }
    if (!externalAuthentication?.Cavv || !externalAuthentication?.Eci) {
      return NextResponse.json(
        { error: "externalAuthentication (resultado do 3DS) é obrigatório no fluxo Braspag." },
        { status: 400 },
      );
    }
    if (!browserFingerprint || String(browserFingerprint).trim() === "") {
      return NextResponse.json(
        { error: "browserFingerprint (ProviderIdentifier da coleta antifraude) é obrigatório." },
        { status: 400 },
      );
    }

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });

    // Mesma regra da Cielo: 1 noite = só à vista.
    if (draft.nights === 1 && (installments || 1) > 1) {
      return NextResponse.json(
        { approved: false, returnMessage: "Estadias de 1 noite só permitem pagamento à vista. Use 1x ou Pix." },
        { status: 400 },
      );
    }

    // ---- Recálculo do valor SERVER-SIDE (idêntico à Cielo) ----
    if (
      amountOverride !== undefined &&
      (amountOverride < draft.finalTotal || amountOverride > draft.finalTotal * 2)
    ) {
      return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
    }
    const valorACobrar = amountOverride && amountOverride > draft.finalTotal ? amountOverride : draft.finalTotal;
    const amountCents = Math.round(valorACobrar * 100);

    // ---- Endereço de cobrança (obrigatório p/ antifraude) ----
    const billingAddress: BraspagAddress = {
      Street: billing?.street || "",
      Number: billing?.number || "",
      Complement: billing?.complement || "",
      ZipCode: (billing?.zipCode || "").replace(/\D/g, ""),
      City: billing?.city || "",
      State: billing?.state || "",
      Country: "BRA",
      District: billing?.neighborhood || "",
    };

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    // ---- Autorização (sem Capture) + Antifraude (FingerPrintId) ----
    const auth = await createBraspagAuthorization({
      orderId: draftId,
      amount: amountCents,
      installments: installments || 1,
      customer: {
        name: `${draft.guestFirstName} ${draft.guestLastName}`,
        identity: (draft.guestCpf || "").replace(/\D/g, ""),
        email: draft.guestEmail,
        ipAddress,
        phone: (draft.guestPhone || "").replace(/\D/g, ""),
        billingAddress,
        deliveryAddress: billingAddress,
      },
      card: {
        number: cardNumber,
        holder: cardHolder,
        expiration: cardExpiration,
        cvv: cardCvv,
        brand: detectCardBrand(cardNumber),
      },
      externalAuthentication: {
        Cavv: externalAuthentication.Cavv || "",
        Xid: externalAuthentication.Xid || "",
        Eci: externalAuthentication.Eci || "",
        Version: externalAuthentication.Version || "",
        ReferenceId: externalAuthentication.ReferenceId || "",
      },
      fraud: {
        browserFingerprint: String(browserFingerprint),
        hostName: req.headers.get("host") || "",
        cartItems: [
          {
            name: `${draft.propertyName} (${draft.nights} noites)`,
            quantity: 1,
            sku: draftId,
            unitPrice: amountCents,
            risk: "Normal",
            type: "Default",
          },
        ],
        shipping: { method: "None", phone: (draft.guestPhone || "").replace(/\D/g, "") },
      },
    });

    const binLog = cardNumber.replace(/\s/g, "").slice(0, 6);

    // ============ DECISÃO ============
    // 1) Antifraude Reject(2) ou Review(3), ou análise ausente → NÃO capturar.
    //    Cancela a autorização (void) p/ não prender limite e alerta por e-mail.
    const fraudBlocked = auth.fraudStatus === 2 || auth.fraudStatus === 3 || auth.fraudStatus === undefined;
    if (fraudBlocked) {
      if (auth.paymentId) {
        try {
          await voidBraspagPayment(auth.paymentId, amountCents);
        } catch (e) {
          console.error("[Braspag:credit] void falhou após bloqueio AF:", e);
        }
      }
      const afLabel =
        auth.fraudStatus === 2 ? "Reject" : auth.fraudStatus === 3 ? "Review" : "sem retorno (undefined)";
      console.error("[Braspag:AF-bloqueio]", JSON.stringify({ draftId, paymentId: auth.paymentId, fraudStatus: auth.fraudStatus, score: auth.fraudScore, bin: binLog }));
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: `Antifraude ${afLabel} (score ${auth.fraudScore ?? "?"}) — autorização cancelada (void). PaymentId ${auth.paymentId ?? "-"}`,
        mensagemCliente: "Antifraude não aprovou; nenhum valor cobrado.",
        draftId,
      });
      return NextResponse.json(
        {
          approved: false,
          returnMessage:
            "Não foi possível concluir o pagamento. Nenhum valor foi cobrado — tente novamente ou fale conosco no WhatsApp.",
        },
        { status: 402 },
      );
    }

    // 2) Autorização negada (Status != 1) → mapeia código p/ mensagem amigável.
    if (auth.statusCode !== 1) {
      const mensagemCliente = mensagemRecusaBraspag(auth.returnCode);
      const motivoInterno = auth.returnMessage
        ? `${auth.returnMessage} (código ${auth.returnCode})`
        : `código ${auth.returnCode}`;
      console.error("[Braspag:Recusa]", JSON.stringify({ draftId, valor: valorACobrar, returnCode: auth.returnCode, returnMessage: auth.returnMessage, bin: binLog }));
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: motivoInterno,
        mensagemCliente,
        draftId,
      });
      return NextResponse.json({ approved: false, returnMessage: mensagemCliente }, { status: 402 });
    }

    // 3) Autorizado (Status 1) + Antifraude Accept(1) → CAPTURA separada.
    const cap = await captureBraspagPayment(auth.paymentId!, amountCents);
    if (cap.statusCode !== 2) {
      // Captura falhou após autorizar: cancela p/ não prender limite e alerta.
      try {
        await voidBraspagPayment(auth.paymentId!, amountCents);
      } catch (e) {
        console.error("[Braspag:credit] void falhou após captura malsucedida:", e);
      }
      console.error("[Braspag:CapturaFalhou]", JSON.stringify({ draftId, paymentId: auth.paymentId, capStatus: cap.statusCode, returnCode: cap.returnCode }));
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: `Captura não concluída (status ${cap.statusCode}, código ${cap.returnCode}) — void aplicado. PaymentId ${auth.paymentId}`,
        mensagemCliente: "Falha na captura; nenhum valor cobrado.",
        draftId,
      });
      return NextResponse.json(
        {
          approved: false,
          returnMessage:
            "Não foi possível concluir o pagamento. Nenhum valor foi cobrado — tente novamente ou fale conosco no WhatsApp.",
        },
        { status: 402 },
      );
    }

    // ---- Pago (Status 2): mesmo pós-pagamento da Cielo ----
    await updateDraft(draftId, { braspagPaymentId: auth.paymentId, status: "paid" });

    const property = getPropertyBySlug(draft.propertyId);
    if (property) {
      const totalDiscount = (draft.couponDiscount || 0) + (draft.pixDiscount || 0);
      const reservation = await createHostawayReservation({
        listingMapId: property.id,
        arrivalDate: draft.checkin,
        departureDate: draft.checkout,
        numberOfGuests: draft.guests,
        guestFirstName: draft.guestFirstName,
        guestLastName: draft.guestLastName,
        guestEmail: draft.guestEmail,
        phone: draft.guestPhone,
        totalPrice: valorACobrar,
        subtotalOriginal: draft.subtotal ?? draft.totalPrice,
        discountAmount: totalDiscount,
        couponCode: draft.couponCode,
        installments: installments || 1,
        paymentMethod: "card",
        currency: "BRL",
        guestNotes: draft.guestNotes || "",
        source: "solarium-direct",
        packageName: draft.packageName,
        extrasList: draft.extrasList,
        shortNotice: draft.shortNotice,
        serviceExtras: enrichServiceExtras(draft.serviceExtras),
        opExtras: draft.opExtras,
      });
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
        const opExtrasForEmail = await blockOpExtraNights(property.slug, draft.opExtras);
        console.log("📧 NOVA RESERVA PAGA (Braspag):", {
          hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
          propriedade: draft.propertyName,
          checkin: draft.checkin,
          checkout: draft.checkout,
          valorCobrado: `R$ ${valorACobrar.toFixed(2)}`,
          metodo: `Cartão ${installments || 1}x`,
          hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
          braspagId: auth.paymentId,
        });
        await enviarAlertaAprovacao({
          hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
          propriedade: draft.propertyName,
          valor: valorACobrar,
          checkin: draft.checkin,
          checkout: draft.checkout,
          noites: draft.nights,
          metodo: `Cartão ${installments || 1}x`,
          hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
          shortNotice: draft.shortNotice,
          serviceExtras: enrichServiceExtras(draft.serviceExtras),
          opExtras: opExtrasForEmail,
        });
      } else {
        // Pago, Hostaway falhou → criação manual (mesmo fallback da Cielo).
        await updateDraft(draftId, { hostawayReservationId: -1 });
        console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY (Braspag) 🚨🚨🚨");
        console.error(
          JSON.stringify(
            {
              ACAO_NECESSARIA: "Criar reserva manualmente no Hostaway",
              propriedade: draft.propertyName,
              listingId: property.id,
              checkin: draft.checkin,
              checkout: draft.checkout,
              hospedes: draft.guests,
              nome: `${draft.guestFirstName} ${draft.guestLastName}`,
              email: draft.guestEmail,
              telefone: draft.guestPhone,
              cpf: draft.guestCpf,
              valorTotal: draft.finalTotal,
              valorCobrado: valorACobrar,
              pagamento: "Cartão (Braspag)",
              parcelas: installments || 1,
              braspagPaymentId: auth.paymentId,
              draftId,
            },
            null,
            2,
          ),
        );
      }
    }

    return NextResponse.json({
      approved: true,
      paymentId: auth.paymentId,
      redirectTo: `/reservar/${draftId}/confirmacao`,
    });
  } catch (err) {
    console.error("[/api/payments/braspag/credit] Exception:", err);
    const message =
      (err as Error)?.message?.startsWith("Braspag:")
        ? (err as Error).message.replace("Braspag: ", "")
        : "Erro ao processar pagamento. Tente novamente ou fale com o concierge.";
    return NextResponse.json({ approved: false, returnMessage: message, error: message }, { status: 500 });
  }
}
