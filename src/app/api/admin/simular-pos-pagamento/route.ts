import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-auth";
import { getDraft, updateDraft, savePaymentIndex, enfileirarFinalizacaoHostaway, scanFinalizacoesHostaway, lerConversoesDaReserva } from "@/lib/kv-store";
import { revalidarDraftAntesDeCobrar } from "@/lib/pricing/revalidar-draft";
import { createHostawayReservation, cancelHostawayReservation } from "@/lib/hostaway";
import { enviarConversaoReserva, itensDaReserva } from "@/lib/analytics/server-conversions";
import { decomposicaoParaEnvio, enviarDecomposicaoAtivo } from "@/lib/hostaway-financeiro";
import { getPropertyBySlug } from "@/config/properties";
import { enrichServiceExtras } from "@/config/service-extras";
import { paramsDePacote } from "@/lib/reserva-pacote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SIMULAÇÃO DE PÓS-PAGAMENTO — o fluxo real a partir do ponto em que a
 * autorização já teria dado certo, SEM cobrar cartão nenhum.
 *
 * POR QUE EXISTE. Tudo que acontece depois do "aprovado" — criar a reserva,
 * disparar a conversão, enfileirar a marcação de pagamento — só era exercitado
 * por uma venda de verdade. Testar isso custava um cartão real e um estorno, e
 * por isso quase não era testado: os defeitos apareciam em produção, com um
 * hóspede no meio.
 *
 * O QUE ELA NÃO É. Não valida o 3DS: o 3DS acontece ANTES da autorização, no
 * navegador, e continua sem ter como ser exercitado fora de produção. Esta rota
 * começa depois disso.
 *
 * NENHUM GATEWAY É ALCANÇADO. Este arquivo não importa `braspag.ts` nem
 * `cielo.ts`, nem nada que os importe. O `PaymentId` é sintético e identificável
 * (`SIM-...`). Há uma verificação no smoke que reprova se um import de gateway
 * aparecer aqui.
 */

/** Prefixo do PaymentId sintético. Reconhecível em qualquer log ou painel. */
const PREFIXO_PAGAMENTO = "SIM";

/**
 * Distância mínima entre hoje e a chegada, em dias.
 *
 * Uma reserva de ensaio perto demais entra no horizonte operacional: a equipe a
 * vê na lista de chegadas da semana e trata como real. 90 dias põe o ensaio bem
 * fora do que qualquer pessoa está olhando.
 */
const DIAS_MINIMOS_ADIANTE = 90;

type Etapa = {
  etapa: string;
  ok: boolean;
  detalhe: unknown;
};

export async function POST(req: Request) {
  const negado = exigirAdmin(req);
  if (negado) return negado;

  let body: { draftId?: string; provider?: string; metodo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const draftId = (body.draftId || "").trim();
  if (!draftId) return NextResponse.json({ error: "draftId obrigatório" }, { status: 400 });

  const provider: "braspag" | "cielo" = body.provider === "cielo" ? "cielo" : "braspag";
  const metodo: "credito" | "pix" = body.metodo === "pix" ? "pix" : "credito";

  const etapas: Etapa[] = [];
  const registrar = (etapa: string, ok: boolean, detalhe: unknown) => {
    etapas.push({ etapa, ok, detalhe });
    console.log(`[Simulacao] ${ok ? "ok" : "FALHA"} ${etapa}: ${JSON.stringify(detalhe).slice(0, 400)}`);
  };

  // -------------------------------------------------------------------------
  // GUARDA 0 — código de teste do Meta. ANTES de qualquer coisa.
  //
  // Sem `META_TEST_EVENT_CODE`, o Purchase iria para a conta de anúncios como
  // venda REAL: contaminaria relatório e, pior, alimentaria a otimização de
  // campanha com uma conversão que não existiu. Recusar a simulação inteira é a
  // única saída segura — não existe "simular só um pouco".
  // -------------------------------------------------------------------------
  const metaTestEventCode = (process.env.META_TEST_EVENT_CODE || "").trim();
  if (!metaTestEventCode) {
    return NextResponse.json(
      {
        error:
          "META_TEST_EVENT_CODE ausente. Sem ele a conversão iria ao Meta como venda real " +
          "e entraria na otimização de campanha. Configure o código (Gerenciador de Eventos → " +
          "Testar eventos) e repita.",
        etapas,
      },
      { status: 412 },
    );
  }

  const draft = await getDraft(draftId);
  if (!draft) return NextResponse.json({ error: "Draft não encontrado ou expirado" }, { status: 404 });

  // -------------------------------------------------------------------------
  // GUARDA 1 — datas seguras.
  // -------------------------------------------------------------------------
  const hoje = new Date();
  const chegada = new Date(draft.checkin + "T12:00:00");
  const diasAdiante = Math.round((chegada.getTime() - hoje.getTime()) / 86400000);
  if (!Number.isFinite(diasAdiante) || diasAdiante < DIAS_MINIMOS_ADIANTE) {
    return NextResponse.json(
      {
        error:
          `Datas muito próximas para simular: chegada em ${draft.checkin} (${diasAdiante} dias). ` +
          `Mínimo ${DIAS_MINIMOS_ADIANTE} dias — mais perto que isso, a reserva de ensaio entra no ` +
          "horizonte operacional e alguém a trata como real.",
        etapas,
      },
      { status: 412 },
    );
  }
  registrar("datas-seguras", true, { checkin: draft.checkin, diasAdiante });

  // -------------------------------------------------------------------------
  // ETAPA 1 — revalidação: a MESMA função da rota de cobrança.
  // -------------------------------------------------------------------------
  const revalidacao = await revalidarDraftAntesDeCobrar(draft);
  registrar("revalidacao", revalidacao.ok, revalidacao.ok ? { ok: true } : revalidacao);
  if (!revalidacao.ok) {
    return NextResponse.json(
      { ok: false, pararEm: "revalidacao", motivo: revalidacao.mensagem, etapas },
      { status: 409 },
    );
  }

  const property = getPropertyBySlug(draft.propertyId);
  if (!property) {
    registrar("propriedade", false, { propertyId: draft.propertyId });
    return NextResponse.json({ ok: false, pararEm: "propriedade", etapas }, { status: 500 });
  }

  // PaymentId sintético. Nenhum gateway foi chamado para produzi-lo.
  const paymentIdSintetico = `${PREFIXO_PAGAMENTO}-${provider}-${metodo}-${Date.now().toString(36)}`;
  registrar("payment-id-sintetico", true, { paymentId: paymentIdSintetico, gatewayChamado: false });

  // -------------------------------------------------------------------------
  // ETAPA 2 — reserva na Hostaway, como CONSULTA (`inquiry`).
  //
  // `inquiry` não é reserva confirmada e não bloqueia o calendário: o ensaio não
  // tira disponibilidade de uma venda real. `isPaid: false` mantém o financeiro
  // limpo. O prefixo no nome deixa a reserva óbvia em qualquer listagem.
  // -------------------------------------------------------------------------
  const respostasCruas: { httpStatus: number; corpo: unknown }[] = [];

  // B5 — decomposição financeira: a simulação é o lugar de descobrir o contrato.
  // Com a flag ligada, as linhas vão no corpo e a resposta crua da Hostaway fica
  // no relatório, inclusive o erro. Assim o schema é aprendido sem arriscar uma
  // venda; desligada, o comportamento é o de produção hoje.
  const linhas = decomposicaoParaEnvio(draft, draft.finalTotal, draftId) ?? undefined;
  registrar("decomposicao-financeira", true, {
    flagLigada: enviarDecomposicaoAtivo(),
    linhasMontadas: linhas?.length ?? 0,
    linhas: linhas ?? null,
    nota: enviarDecomposicaoAtivo()
      ? "enviada no corpo — ver resposta crua da Hostaway abaixo"
      : "HOSTAWAY_ENVIAR_DECOMPOSICAO desligada: nada foi enviado",
  });

  const reserva = await createHostawayReservation({
    listingMapId: property.id,
    arrivalDate: draft.checkin,
    departureDate: draft.checkout,
    numberOfGuests: draft.guests,
    guestFirstName: `[SIMULACAO] ${draft.guestFirstName}`,
    guestLastName: draft.guestLastName,
    guestEmail: draft.guestEmail,
    phone: draft.guestPhone,
    totalPrice: draft.finalTotal,
    subtotalOriginal: draft.subtotal ?? draft.totalPrice,
    discountAmount: (draft.couponDiscount || 0) + (draft.pixDiscount || 0),
    couponCode: draft.couponCode,
    paymentMethod: metodo === "pix" ? "pix" : "card",
    currency: "BRL",
    guestNotes: draft.guestNotes || "",
    source: "solarium-simulacao",
    packageName: draft.packageName,
    extrasList: draft.extrasList,
    serviceExtras: enrichServiceExtras(draft.serviceExtras),
    opExtras: draft.opExtras,
    reservaTeste: true,
    linhasFinanceiras: linhas,
    ...paramsDePacote(draft),
    simulacao: { status: "inquiry", isPaid: false },
    coletarResposta: (r) => respostasCruas.push(r),
  });

  registrar("hostaway-reserva", Boolean(reserva), {
    reservationId: reserva?.reservationId ?? null,
    status: "inquiry",
    isPaid: false,
    respostaCrua: respostasCruas,
  });

  if (!reserva) {
    return NextResponse.json(
      {
        ok: false,
        pararEm: "hostaway-reserva",
        // A resposta crua é o produto principal quando a criação falha: é dela
        // que sai o contrato da decomposição.
        respostaCrua: respostasCruas,
        etapas,
      },
      { status: 502 },
    );
  }

  await updateDraft(draftId, { hostawayReservationId: reserva.reservationId });
  await savePaymentIndex({
    payment_id: paymentIdSintetico,
    merchant_order_id: draftId,
    draft_id: draftId,
    provider,
    method: metodo === "pix" ? "pix" : "card",
  });

  // -------------------------------------------------------------------------
  // ETAPA 3 — conversão pelo módulo único, em modo TESTE.
  // -------------------------------------------------------------------------
  const conversao = await enviarConversaoReserva({
    reservationId: reserva.reservationId,
    value: draft.finalTotal,
    items: itensDaReserva(draft),
    provider,
    rotaOrigem: "simulacao",
    gaClientId: draft.gaClientId,
    gaSessionId: draft.gaSessionId,
    fbp: draft.fbp,
    fbc: draft.fbc,
    email: draft.guestEmail,
    phone: draft.guestPhone,
    modoTeste: { metaTestEventCode },
  });
  registrar("conversao", true, {
    ...conversao,
    metaTestEventCode: `configurado (${metaTestEventCode.length} chars)`,
    ga4DebugMode: true,
    nota: "Meta em Testar eventos; GA4 em DebugView. Nenhum dos dois entra em relatório.",
  });

  // -------------------------------------------------------------------------
  // ETAPA 4 — fila de finalização de pagamento.
  // -------------------------------------------------------------------------
  await enfileirarFinalizacaoHostaway({
    reservation_id: reserva.reservationId,
    payment_method: metodo === "pix" ? "bank_transfer" : "credit_card_offline",
    amount: draft.finalTotal,
    currency: "BRL",
    draft_id: draftId,
  });

  const fila = await scanFinalizacoesHostaway();
  const naFila = fila.find((f) => f.reservation_id === reserva.reservationId) ?? null;
  registrar("fila-finalizacao", Boolean(naFila), naFila);

  // -------------------------------------------------------------------------
  // ETAPA 5 — o que ficou gravado em `conversions_sent`.
  // -------------------------------------------------------------------------
  const registros = await lerConversoesDaReserva(String(reserva.reservationId));
  registrar("conversions-sent", registros.length > 0, registros);

  return NextResponse.json({
    ok: true,
    simulacao: true,
    gatewayChamado: false,
    validou3ds: false,
    provider,
    metodo,
    draftId,
    paymentIdSintetico,
    reservationId: reserva.reservationId,
    respostaCruaHostaway: respostasCruas,
    etapas,
    limpeza: {
      reservationId: reserva.reservationId,
      comando:
        `curl -X DELETE -H "x-admin-token: $ADMIN_API_TOKEN" ` +
        `"$BASE_URL/api/admin/simular-pos-pagamento/${reserva.reservationId}"`,
      nota: "A reserva foi criada como `inquiry` e não bloqueia calendário, mas cancele mesmo assim.",
    },
  });
}
