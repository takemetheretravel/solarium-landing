import { NextResponse } from "next/server";
import {
  getDraft,
  updateDraft,
  pushAuthLog,
  savePaymentIndex,
  attachReservationToPaymentIndex,
  enfileirarFinalizacaoHostaway,
} from "@/lib/kv-store";
import { enviarConversaoReserva, itensDaReserva } from "@/lib/analytics/server-conversions";
import { finalizarPagamentoEmSegundoPlano } from "@/lib/hostaway-finalizacao";
import { decomposicaoParaEnvio } from "@/lib/hostaway-financeiro";
import { redact } from "@/lib/log/redact";
import {
  createBraspagAuthorization,
  captureBraspagPayment,
  voidBraspagPayment,
  mensagemRecusaBraspag,
  BRASPAG_URLS,
  type BraspagAddress,
} from "@/lib/braspag";
import { createHostawayReservation } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { blockOpExtraNights } from "@/lib/op-extras-server";
import { paramsDePacote, extrasProvidenciar } from "@/lib/reserva-pacote";
import { enviarAlertaRecusa, enviarAlertaAprovacao } from "@/lib/email";
import { registerOrphanAndAlert } from "@/lib/reservation-recovery";
import { revalidarDraftAntesDeCobrar } from "@/lib/pricing/revalidar-draft";

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
      testAuthCardOverride?: boolean;
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
      testAuthCardOverride,
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

    // ---- Reconferência do draft contra a Hostaway (idêntica à Cielo) ----
    // Roda DEPOIS do 3DS, que é client-side, e ANTES da autorização. Não toca no
    // fluxo 3DS: só decide se a autorização pode acontecer. Recusar aqui aborta
    // uma autenticação já feita — o que é preferível a autorizar preço velho.
    const revalidacao = await revalidarDraftAntesDeCobrar(draft);
    if (!revalidacao.ok) {
      return NextResponse.json(
        {
          approved: false,
          returnMessage: revalidacao.mensagem,
          error: revalidacao.mensagem,
          revalidacao: revalidacao.motivo,
        },
        { status: revalidacao.status },
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

    // ---- Bypass de TESTE, EXCLUSIVO DE SANDBOX ----
    // Limitação do sandbox Braspag: nenhum cartão único autentica no 3DS E é
    // aprovado na autorização. Para validar o CAMINHO DE SUCESSO ponta a ponta,
    // permitimos usar um cartão de autorização diferente (4091688625337641)
    // SOMENTE na etapa de autorização/captura, mantendo o ExternalAuthentication
    // gerado com o cartão de 3DS. NUNCA ativo em produção: o gate exige
    // BRASPAG_ENVIRONMENT !== "production" — em produção o flag é ignorado e o
    // cartão real do cliente é o único usado.
    const isSandbox = process.env.BRASPAG_ENVIRONMENT !== "production";
    const SANDBOX_AUTH_CARD = "4091688625337641";
    const useTestAuthCard =
      isSandbox && testAuthCardOverride === true && !!externalAuthentication.Cavv;
    const authCardNumber = useTestAuthCard ? SANDBOX_AUTH_CARD : cardNumber;
    if (useTestAuthCard) {
      console.warn(
        "[Braspag:credit] ⚠️ SANDBOX testAuthCardOverride ATIVO — usando cartão de autorização de teste (ExternalAuthentication preservado). Jamais ativo em produção.",
      );
    }

    // MerchantOrderId NOVO a cada tentativa.
    //
    // Antes ia o `draftId`, então três cartões diferentes no mesmo draft
    // chegavam à Braspag com o mesmo identificador de pedido. Isso confunde a
    // conciliação e atrapalha o antifraude, que vê repetição onde há só um
    // cliente corrigindo o número do cartão. O `draftId` segue como referência
    // interna, no log e no alerta.
    const tentativaId = `${draftId}-${Date.now().toString(36)}`;

    // ---- Autorização (sem Capture) + Antifraude (FingerPrintId) ----
    const auth = await createBraspagAuthorization({
      orderId: tentativaId,
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
        number: authCardNumber,
        holder: cardHolder,
        expiration: cardExpiration,
        cvv: cardCvv,
        brand: detectCardBrand(authCardNumber),
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

    const authDigits = authCardNumber.replace(/\D/g, "");
    const cardLast4 = authDigits.slice(-4);

    // Dois destinos, dois recortes:
    //
    //  - console.log ([Braspag:authorize-result]): apenas o mínimo para
    //    correlacionar a transação. O log de produção é exportável, então nada
    //    de BIN, credencial, código de estabelecimento ou identificador de
    //    antifraude passa por aqui.
    //  - pushAuthLog (KV, 7 dias, leitura só com segredo): guarda também os
    //    identificadores do antifraude, que a Braspag pede no suporte. Nem lá
    //    entram BIN, MerchantId ou EstablishmentCode.
    let diagnostico: Record<string, unknown> | undefined;
    {
      const rawPayment = ((auth.raw ?? {}) as { Payment?: Record<string, unknown> }).Payment ?? {};
      const rawFa = (rawPayment.FraudAnalysis ?? {}) as Record<string, unknown>;
      const paymentIdResolvido = rawPayment.PaymentId ?? auth.paymentId ?? null;
      const statusResolvido = rawPayment.Status ?? auth.statusCode ?? null;
      const providerReturnCode = rawPayment.ProviderReturnCode ?? null;

      console.log(
        "[Braspag:authorize-result] " +
          JSON.stringify(
            redact({
              merchantOrderId: tentativaId,
              PaymentId: paymentIdResolvido,
              Status: statusResolvido,
              ProviderReturnCode: providerReturnCode,
              // Sem estes dois, `Status: 1` no log é ambíguo: não dá para saber
              // se a transação seguiu para captura ou se o antifraude a barrou
              // logo depois. Classificam a decisão; não identificam a análise.
              FraudAnalysisStatus: rawFa.Status ?? auth.fraudStatus ?? null,
              FraudAnalysisReasonCode: rawFa.FraudAnalysisReasonCode ?? auth.fraudReasonCode ?? null,
              providerUsed: auth.providerUsed ?? null,
              httpStatus: auth.status,
              cardLast4,
            }),
          ),
      );

      const diagnosticoCompleto = {
        env: process.env.BRASPAG_ENVIRONMENT === "production" ? "production" : "sandbox",
        baseUrl: BRASPAG_URLS.transactional,
        providerUsed: auth.providerUsed ?? null,
        merchantOrderId: tentativaId,
        httpStatus: auth.status,
        cardLast4,
        testAuthCardOverride: useTestAuthCard,
        PaymentId: paymentIdResolvido,
        Tid: rawPayment.Tid ?? null,
        ProofOfSale: rawPayment.ProofOfSale ?? null,
        AuthorizationCode: rawPayment.AuthorizationCode ?? null,
        Status: statusResolvido,
        ReturnCode: rawPayment.ReturnCode ?? auth.returnCode ?? null,
        ReturnMessage: rawPayment.ReturnMessage ?? auth.returnMessage ?? null,
        ProviderReturnCode: providerReturnCode,
        ProviderReturnMessage: rawPayment.ProviderReturnMessage ?? null,
        FraudAnalysisId: rawFa.Id ?? null,
        FraudAnalysisStatus: rawFa.Status ?? auth.fraudStatus ?? null,
        FraudAnalysisReasonCode: rawFa.FraudAnalysisReasonCode ?? auth.fraudReasonCode ?? null,
        FraudScore: auth.fraudScore ?? null,
        // Corpo cru do erro da Braspag quando não-2xx (ex.: [{Code,Message}]).
        errorBody: auth.errorBody ?? null,
      };
      await pushAuthLog(diagnosticoCompleto);
      diagnostico = diagnosticoCompleto;
    }

    // Índice de correlação gravado NA AUTORIZAÇÃO. O webhook do gateway não
    // carrega MerchantOrderId no corpo; com este registro ele resolve a reserva
    // por consulta local, sem depender do payload nem de ida à API.
    if (auth.paymentId) {
      await savePaymentIndex({
        payment_id: auth.paymentId,
        merchant_order_id: tentativaId,
        draft_id: draftId,
        provider: "braspag",
        method: "card",
      });
    }

    // ============ DECISÃO (fluxo AuthorizeFirst) ============
    // A autorização acontece PRIMEIRO; o antifraude analisa DEPOIS (só se
    // autorizou). Regra do void: ele é chamado em TODO caminho onde AUTORIZOU
    // (Status 1) mas NÃO capturou — para liberar o limite do cliente. Se o banco
    // negou (Status != 1), não há hold → NÃO chamamos void.

    // 1) NÃO autorizado (Status != 1). Distingue dois casos:
    //    - httpStatus não-2xx → ERRO DE REQUISIÇÃO (credencial/payload inválido),
    //      não é recusa do emissor. Rótulo "[Braspag:ErroRequisicao]" + errorBody.
    //    - httpStatus 2xx com Status de negativa → recusa real → "[Braspag:Recusa]".
    if (auth.statusCode !== 1) {
      const httpOk = auth.status >= 200 && auth.status < 300;
      const mensagemCliente = mensagemRecusaBraspag(auth.returnCode);
      if (!httpOk) {
        console.error(
          "[Braspag:ErroRequisicao]",
          JSON.stringify({
            draftId,
            httpStatus: auth.status,
            providerUsed: auth.providerUsed,
            returnCode: auth.returnCode ?? null,
            errorBody: auth.errorBody ?? null,
            cardLast4,
          }),
        );
      } else {
        console.error(
          "[Braspag:Recusa]",
          JSON.stringify({ draftId, valor: valorACobrar, returnCode: auth.returnCode, returnMessage: auth.returnMessage, cardLast4 }),
        );
      }
      const motivoInterno = httpOk
        ? auth.returnMessage
          ? `${auth.returnMessage} (código ${auth.returnCode})`
          : `código ${auth.returnCode}`
        : `Erro de requisição (HTTP ${auth.status}): ${JSON.stringify(auth.errorBody ?? auth.returnMessage ?? "?")}`;
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: motivoInterno,
        mensagemCliente,
        draftId,
        pacoteNome: draft.pacoteNome,
        merchantOrderId: tentativaId,
        diagnostico,
      });
      return NextResponse.json({ approved: false, returnMessage: mensagemCliente }, { status: 402 });
    }

    // Daqui em diante: AUTORIZADO (Status 1). Qualquer saída sem captura → VOID.

    // 2) Antifraude NÃO aprovou (Reject 2 / Review 3 / ausente) → void + alerta.
    if (auth.fraudStatus !== 1) {
      try {
        await voidBraspagPayment(auth.paymentId!, amountCents);
      } catch (e) {
        console.error("[Braspag:credit] void falhou após bloqueio AF:", e);
      }
      const afLabel =
        auth.fraudStatus === 2 ? "Reject" : auth.fraudStatus === 3 ? "Review" : "sem retorno (undefined)";
      // Sem score nem id do antifraude: os dois ficam só no authlog do KV.
      // `autorizadoMasCancelado` é a linha que explica o par que confundia a
      // leitura do log: autorização com Status 1 e ProviderReturnCode "00" que
      // mesmo assim não vira reserva, porque o void desfez a autorização.
      console.error(
        "[Braspag:AF-bloqueio]",
        JSON.stringify({
          draftId,
          paymentId: auth.paymentId,
          fraudStatus: auth.fraudStatus,
          fraudReasonCode: auth.fraudReasonCode ?? null,
          decisao: afLabel,
          autorizadoMasCancelado: true,
          reservaCriada: false,
        }),
      );
      await enviarAlertaRecusa({
        hospede: `${draft.guestFirstName} ${draft.guestLastName}`,
        propriedade: draft.propertyName,
        valor: valorACobrar,
        motivo: `Antifraude ${afLabel} (score ${auth.fraudScore ?? "?"}) — autorizado mas cancelado (void). PaymentId ${auth.paymentId ?? "-"}`,
        pacoteNome: draft.pacoteNome,
        merchantOrderId: tentativaId,
        diagnostico,
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
    if (!property) {
      // CAMINHO SILENCIOSO FECHADO. Antes: `if (property)` sem `else` — a
      // propriedade não resolvendo pulava a criação da reserva inteira e a rota
      // ainda respondia `approved: true`. Cliente cobrado, sem reserva, sem log.
      console.error(
        "🚨 PAGO SEM RESERVA — propriedade não resolvida " +
          JSON.stringify({ draftId, propertyId: draft.propertyId, paymentId: auth.paymentId }),
      );
    }
    if (property) {
      const totalDiscount = (draft.couponDiscount || 0) + (draft.pixDiscount || 0);
      const reservationParams = {
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
        paymentMethod: "card" as const,
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
      };
      // Bloquear ANTES de criar. O check-in do listing e as 15h e o hospede
      // fica ate as 18h: sem o bloqueio, da para aceitar reserva nova com
      // ele ainda na casa. Nunca criar com o bloqueio falhando em silencio.
      const bloqueio = await blockOpExtraNights(property.slug, draft);
      const opExtrasForEmail = bloqueio.resultados;
      if (!bloqueio.todasBloqueadas) {
        console.error("[Reserva] BLOQUEIO FALHOU — reserva nao criada", draftId);
      }
      const reservation = bloqueio.todasBloqueadas
        ? await createHostawayReservation(reservationParams)
        : null;
      if (reservation) {
        await updateDraft(draftId, { hostawayReservationId: reservation.reservationId });
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
        if (auth.paymentId) {
          await attachReservationToPaymentIndex(auth.paymentId, reservation.reservationId);
        }

        // Marcação de pagamento na Hostaway: ENFILEIRADA (ver a rota Cielo).
        await enfileirarFinalizacaoHostaway({
          reservation_id: reservation.reservationId,
          payment_method: "credit_card_offline",
          amount: valorACobrar,
          currency: "BRL",
          draft_id: draftId,
        });
        // Camada 1: tenta ja, em segundo plano. A fila acima e a rede de seguranca.
        finalizarPagamentoEmSegundoPlano({
          reservation_id: reservation.reservationId,
          payment_method: "credit_card_offline",
          amount: valorACobrar,
          currency: "BRL",
        });

        // Conversão pelo módulo único, o mesmo que a rota Cielo chama.
        await enviarConversaoReserva({
          reservationId: reservation.reservationId,
          value: valorACobrar,
          items: itensDaReserva(draft),
          provider: "braspag",
          rotaOrigem: "braspag",
                    gaClientId: draft.gaClientId,
          gaSessionId: draft.gaSessionId,
          fbp: draft.fbp,
          fbc: draft.fbc,
          email: draft.guestEmail,
          phone: draft.guestPhone,
          clientIpAddress: ipAddress,
          clientUserAgent: req.headers.get("user-agent") || undefined,
        });
      } else {
        // SALVAGUARDA: capturou (pago) mas Hostaway falhou → alerta imediato +
        // órfão para reprocesso na reconciliação. Nenhum valor a estornar (pago).
        await updateDraft(draftId, { hostawayReservationId: -1 });
        console.error("🚨🚨🚨 CRIAR RESERVA MANUALMENTE NO HOSTAWAY (Braspag cartão) 🚨🚨🚨");
        await registerOrphanAndAlert({
          paymentId: auth.paymentId || draftId,
          draftId,
          method: "card",
          error: "createHostawayReservation retornou null (cartão capturado)",
          reservationParams,
          noites: draft.nights,
        });
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
