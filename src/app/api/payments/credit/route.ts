import { NextResponse } from "next/server";
import {
  getDraft,
  updateDraft,
  savePaymentIndex,
  attachReservationToPaymentIndex,
  enfileirarFinalizacaoHostaway,
} from "@/lib/kv-store";
import { enviarConversaoReserva, itensDaReserva } from "@/lib/analytics/server-conversions";
import { decomposicaoParaEnvio } from "@/lib/hostaway-financeiro";
import { createCreditPayment } from "@/lib/cielo";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { enviarAlertaRecusa, enviarAlertaAprovacao } from "@/lib/email";

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
      const motivoInterno = result.returnMessage ? `${result.returnMessage} (código ${result.returnCode})` : `código ${result.returnCode}`;
      console.error("[Cielo:Recusa]", JSON.stringify({
        draftId, valor: valorACobrar, returnCode: result.returnCode,
        returnMessage: result.returnMessage,
        cardLast4: cardNumber?.replace(/\s/g, "").slice(-4),
      }));
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: motivoInterno,
        mensagemCliente: result.mensagemAmigavel,
        draftId,
      });
      return NextResponse.json(
        { approved: false, returnMessage: result.mensagemAmigavel },
        { status: 402 },
      );
    }

    await updateDraft(draftId, { cieloPaymentId: result.paymentId, status: "paid" });

    // Índice de correlação: o webhook da Cielo não traz MerchantOrderId no corpo,
    // e sem este registro ele depende de ida à API para achar a reserva.
    if (result.paymentId) {
      await savePaymentIndex({
        payment_id: result.paymentId,
        merchant_order_id: draftId,
        draft_id: draftId,
        provider: "cielo",
        method: "card",
      });
    }

    const property = getPropertyBySlug(draft.propertyId);
    if (!property) {
      // CAMINHO SILENCIOSO FECHADO. Antes: `if (property)` sem `else` — a
      // propriedade não resolvendo pulava a criação da reserva inteira e a rota
      // ainda respondia `approved: true`. Cliente cobrado, sem reserva, sem log.
      console.error(
        "🚨 PAGO SEM RESERVA — propriedade não resolvida " +
          JSON.stringify({ draftId, propertyId: draft.propertyId, cieloPaymentId: result.paymentId }),
      );
    }
    if (property) {
      const totalDiscount = (draft.couponDiscount || 0) + (draft.pixDiscount || 0);
        // Bloquear ANTES de criar: o check-in do listing e as 15h e o hospede fica
        // ate as 18h. Sem o bloqueio, da para aceitar reserva nova com ele na casa.
        const bloqueio = await blockOpExtraNights(property.slug, draft);
      const reservation = bloqueio.todasBloqueadas ? await createHostawayReservation({
        listingMapId: property.id,
        arrivalDate: draft.checkin,
        departureDate: draft.checkout,
        numberOfGuests: draft.guests,
        guestFirstName: draft.guestFirstName,
        guestLastName: draft.guestLastName,
        guestEmail: draft.guestEmail,
        phone: draft.guestPhone,
        totalPrice: valorACobrar, // VALOR REAL COBRADO (com juros, se houver)
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
        linhasFinanceiras: decomposicaoParaEnvio(draft, valorACobrar, draftId) ?? undefined,
        ...paramsDePacote(draft),
      }) : null;
      if (!bloqueio.todasBloqueadas) {
        console.error("[Reserva] BLOQUEIO DE NOITE FALHOU — reserva nao criada");
      }
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });

        const opExtrasForEmail = bloqueio.resultados;

        console.log("📧 NOVA RESERVA PAGA:", {
          hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
          propriedade: draft.propertyName,
          checkin: draft.checkin,
          checkout: draft.checkout,
          valorCobrado: `R$ ${valorACobrar.toFixed(2)}`,
          metodo: `Cartão ${installments || 1}x`,
          hostawayUrl: `https://dashboard.hostaway.com/reservations/${reservation.reservationId}/edit`,
          cieloId: result.paymentId,
        });
        await enviarAlertaAprovacao({
        pacoteNome: draft.pacoteNome,
        extrasProvidenciar: extrasProvidenciar(draft),
        dataLimiteCancelamentoExtras: draft.dataLimiteCancelamentoExtras,
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

        if (result.paymentId) {
          await attachReservationToPaymentIndex(result.paymentId, reservation.reservationId);
        }

        // Marcação de pagamento na Hostaway: ENFILEIRADA, não tentada aqui. A
        // Hostaway tem lag entre criar a reserva e aceitar a cobrança, e uma
        // tentativa síncrona falharia na maioria das vezes — segurar a resposta
        // esperando o lag passar é pior ainda, com o cliente na tela.
        await enfileirarFinalizacaoHostaway({
          reservation_id: reservation.reservationId,
          payment_method: "credit_card_offline",
          amount: valorACobrar,
          currency: "BRL",
          draft_id: draftId,
        });

        // Conversão pelo módulo único, o mesmo que a rota Braspag chama.
        await enviarConversaoReserva({
          reservationId: reservation.reservationId,
          value: valorACobrar,
          items: itensDaReserva(draft),
          provider: "cielo",
          gaClientId: draft.gaClientId,
          gaSessionId: draft.gaSessionId,
          fbp: draft.fbp,
          fbc: draft.fbc,
          email: draft.guestEmail,
          phone: draft.guestPhone,
          clientIpAddress:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            undefined,
          clientUserAgent: req.headers.get("user-agent") || undefined,
        });
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
