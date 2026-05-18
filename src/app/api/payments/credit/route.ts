import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/kv-store";
import { createCreditPayment } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { draftId, cardNumber, cardHolder, cardExpiration, cardCvv, installments, amountOverride } =
      (await req.json()) as {
        draftId?: string;
        cardNumber?: string;
        cardHolder?: string;
        cardExpiration?: string;
        cardCvv?: string;
        installments?: number;
        amountOverride?: number;
      };

    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
    if (!cardNumber || !cardHolder || !cardExpiration || !cardCvv) {
      return NextResponse.json({ error: "Dados do cartão incompletos" }, { status: 400 });
    }

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });

    if (draft.nights === 1 && (installments || 1) > 1) {
      return NextResponse.json(
        { approved: false, returnMessage: "Estadias de 1 noite só permitem pagamento à vista. Use 1x ou Pix." },
        { status: 400 },
      );
    }

    // amountOverride = valor com juros embutidos (parcelamento > sem-juros do cupom)
    if (
      amountOverride !== undefined &&
      (amountOverride < draft.finalTotal || amountOverride > draft.finalTotal * 2)
    ) {
      return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
    }
    const valorACobrar = amountOverride && amountOverride > draft.finalTotal ? amountOverride : draft.finalTotal;
    const amountCents = Math.round(valorACobrar * 100);

    const result = await createCreditPayment({
      orderId: draftId,
      amount: amountCents,
      installments: installments || 1,
      cardNumber,
      cardHolder,
      cardExpiration,
      cardCvv,
      customerName: `${draft.guestFirstName} ${draft.guestLastName}`,
      customerCpf: draft.guestCpf,
      customerEmail: draft.guestEmail,
    });

    if (!result.approved) {
      return NextResponse.json(
        { approved: false, returnMessage: result.returnMessage || "Pagamento não aprovado. Verifique os dados do cartão." },
        { status: 402 },
      );
    }

    await updateDraft(draftId, { cieloPaymentId: result.paymentId, status: "paid" });

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
        totalPrice: draft.subtotal ?? draft.totalPrice,
        discountAmount: totalDiscount,
        couponCode: draft.couponCode,
        currency: "BRL",
        notes: `Cartão${draft.couponCode ? ` | Cupom: ${draft.couponCode}` : ""}${draft.guestNotes ? ` | ${draft.guestNotes}` : ""}`,
        source: "solarium-direct",
      });
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
      } else {
        // Pagamento aprovado, Hostaway falhou → marca para criação manual
        await updateDraft(draftId, { hostawayReservationId: -1 });
        console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY 🚨🚨🚨");
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
              pagamento: "Cartão",
              parcelas: installments || 1,
              cieloPaymentId: result.paymentId,
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
      paymentId: result.paymentId,
      redirectTo: `/reservar/${draftId}/confirmacao`,
    });
  } catch (err) {
    console.error("[/api/payments/credit] Exception:", err);
    const message =
      (err as Error)?.message?.startsWith("Cielo:")
        ? (err as Error).message.replace("Cielo: ", "")
        : "Erro ao processar pagamento. Tente novamente ou fale com o concierge.";
    return NextResponse.json({ approved: false, returnMessage: message, error: message }, { status: 500 });
  }
}
