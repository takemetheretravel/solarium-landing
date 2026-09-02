import crypto from "crypto";
import {
  conversionAlreadySent,
  markConversionSent,
  type RotaOrigemConversao,
} from "@/lib/kv-store";

/**
 * Envio de conversão server-side (GA4 Measurement Protocol + Meta CAPI).
 *
 * Regras que este módulo NUNCA quebra:
 *  - Variável de ambiente ausente → pula em silêncio, com aviso em nível warn.
 *  - Qualquer falha (rede, token, 4xx) é engolida: analytics jamais derruba uma
 *    reserva já paga.
 *  - Idempotência em duas camadas: quem chama já passou pela guarda de
 *    `webhook_events` (30 dias), e aqui `conversions_sent` (24 meses) barra o
 *    par (transaction_id, destino) já enviado. A segunda existe para a
 *    reentrega tardia e o reprocessamento manual, que escapam da primeira.
 */

const TIMEOUT_MS = 8000;

export type ConversaoItem = {
  item_id: string;
  item_name: string;
  price?: number;
  quantity?: number;
};

export type ConversaoParams = {
  /** Identificador canônico: número da reserva Hostaway (ou draftId como fallback). */
  transactionId: string;
  value: number;
  currency: string;
  items: ConversaoItem[];
  /** Persistidos no draft quando o cliente ainda estava no site. */
  gaClientId?: string;
  gaSessionId?: string;
  fbp?: string;
  fbc?: string;
  /** Usados só como dado hasheado no Meta CAPI (nunca em claro no log). */
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  // --- Reenvio retroativo (script de recuperação) ---
  // Ausentes no fluxo normal: aí o evento é "agora". Presentes, carimbam o
  // horário ORIGINAL da compra. Cada plataforma tem seu limite de retroação —
  // GA4 aceita 72 horas, Meta CAPI aceita 7 dias.
  /** Microssegundos epoch, para o `timestamp_micros` do GA4. */
  timestampMicros?: number;
  /** Segundos epoch, para o `event_time` do Meta. */
  eventTimeSegundos?: number;
  /** Caminho que originou a conversão — vai para o diagnóstico. */
  rotaOrigem?: RotaOrigemConversao;
  provider?: string;
  /**
   * Modo TESTE — a simulação de pós-pagamento.
   *
   * O evento continua sendo enviado de verdade, pelo MESMO código do fluxo real
   * (mandar por um caminho paralelo não provaria nada sobre o caminho real), mas
   * marcado de forma que nenhuma das duas plataformas o conte:
   *
   * - Meta: `test_event_code` põe o evento em "Testar eventos" e fora dos
   *   relatórios. O código é OBRIGATÓRIO aqui — sem ele o envio é recusado antes
   *   de sair, em vez de virar Purchase real numa conta de anúncios.
   * - GA4: `debug_mode: true` manda o evento para o DebugView, sem contaminar
   *   relatório. O GA4 não tem equivalente ao `test_event_code`; `debug_mode` é
   *   o que existe.
   */
  modoTeste?: { metaTestEventCode: string };
};

function sha256(valor: string): string {
  return crypto.createHash("sha256").update(valor.trim().toLowerCase()).digest("hex");
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confere o payload no endpoint de depuração do GA4 e loga o veredito.
 *
 * Existe porque `/mp/collect` responde **204 para tudo** — medido: 204 com
 * measurement_id inexistente, api_secret errado e corpo sem evento nenhum. Ou
 * seja, o status HTTP do envio real não distingue evento contabilizado de
 * evento descartado em silêncio, e foi isso que deixou a dúvida de pé.
 * `/debug/mp/collect` roda a mesma validação e DEVOLVE os problemas.
 *
 * Só observa: nunca altera o resultado do envio, e falha dela é engolida.
 */
async function validarPayloadGa4(
  measurementId: string,
  apiSecret: string,
  corpo: unknown,
  transactionId: string,
): Promise<{ ok: boolean; mensagens?: string[] }> {
  try {
    const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(
      measurementId,
    )}&api_secret=${encodeURIComponent(apiSecret)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let dados: { validationMessages?: { description?: string; validationCode?: string }[] };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      dados = (await res.json().catch(() => ({}))) as typeof dados;
    } finally {
      clearTimeout(timer);
    }

    const problemas = dados?.validationMessages ?? [];
    if (problemas.length === 0) {
      console.log(`[Conversao:GA4] validacao ok transaction_id=${transactionId}`);
      return { ok: true };
    }
    const mensagens = problemas.map((m) => `${m.validationCode ?? "?"}: ${m.description ?? "?"}`);
    console.error(
      `[Conversao:GA4] VALIDACAO REPROVOU transaction_id=${transactionId} — ` + mensagens.join(" | "),
    );
    return { ok: false, mensagens };
  } catch (err) {
    const msg = (err as Error)?.message ?? "erro";
    console.log(`[Conversao:GA4] validacao indisponivel transaction_id=${transactionId}: ${msg}`);
    return { ok: false, mensagens: [`validacao indisponivel: ${msg}`] };
  }
}

/**
 * GA4 `purchase` via Measurement Protocol.
 *
 * O measurement id vem de `GA4_MEASUREMENT_ID` e precisa ser o stream DO SITE.
 * Mandar para o stream do motor de reservas duplicaria a conversão em duas
 * propriedades e nenhuma das duas fecharia com a outra.
 */
async function enviarGa4(p: ConversaoParams): Promise<"enviado" | "pulado" | "falhou"> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    // `console.log`, nao `warn`: o export de log da Vercel nao captura warn —
    // 0 linhas de warn em 4.552 exportadas. Um aviso invisivel e um silencio.
    console.log(
      `[Conversao:GA4] pulado transaction_id=${p.transactionId} — ` +
        `GA4_MEASUREMENT_ID=${measurementId ? "ok" : "AUSENTE"} ` +
        `GA4_API_SECRET=${apiSecret ? "ok" : "AUSENTE"}`,
    );
    // Registra a AUSENCIA: sem isso, "nao ha registro" e ambiguo entre "nunca
    // tentou" e "tentou e faltou credencial".
    await markConversionSent({
      transactionId: p.transactionId,
      destino: "ga4",
      httpStatus: null,
      resultado: "pulado_sem_credencial",
      rotaOrigem: p.rotaOrigem,
      provider: p.provider,
    });
    return "pulado";
  }

  // Guarda de reenvio. A do webhook cobre a reentrega dentro da janela dela;
  // esta cobre reprocessamento manual e reentrega tardia, por 24 meses.
  if (await conversionAlreadySent(p.transactionId, "ga4")) {
    console.log(`[Conversao:GA4] já enviado antes, pulando transaction_id=${p.transactionId}`);
    return "pulado";
  }

  // Sem client_id o GA4 aceita o hit mas não o liga a nenhuma sessão. Um valor
  // derivado do transaction_id mantém o evento contável e estável entre reenvios.
  const clientId = p.gaClientId || `server.${sha256(p.transactionId).slice(0, 16)}`;

  const corpo: Record<string, unknown> = {
    client_id: clientId,
    non_personalized_ads: false,
    // Reenvio retroativo: o GA4 aceita eventos com até 72h de atraso, e sem
    // este campo o evento seria carimbado com a hora do envio, não a da compra.
    ...(p.timestampMicros ? { timestamp_micros: p.timestampMicros } : {}),
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: p.transactionId,
          value: p.value,
          currency: p.currency,
          // Simulação: DebugView em vez de relatório. É o mais perto de um
          // `test_event_code` que o GA4 oferece.
          ...(p.modoTeste ? { debug_mode: true } : {}),
          ...(p.gaSessionId ? { session_id: p.gaSessionId } : {}),
          items: p.items.map((i) => ({
            item_id: i.item_id,
            item_name: i.item_name,
            price: i.price,
            quantity: i.quantity ?? 1,
          })),
        },
      },
    ],
  };

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurementId,
    )}&api_secret=${encodeURIComponent(apiSecret)}`;
    const r = await postJson(url, corpo);
    // Registrado mesmo em não-2xx: o hit saiu, e repetir sem saber se o GA4 o
    // aceitou é o caminho para contar a mesma reserva duas vezes.
    if (!r.ok) {
      await markConversionSent({
        transactionId: p.transactionId,
        destino: "ga4",
        httpStatus: r.status,
        resultado: "falha",
        rotaOrigem: p.rotaOrigem,
        provider: p.provider,
      });
      console.error(`[Conversao:GA4] falhou http=${r.status} transaction_id=${p.transactionId}`);
      return "falhou";
    }
    // ATENÇÃO ao ler este log: o Measurement Protocol responde 204 SEMPRE —
    // inclusive com measurement_id inexistente, api_secret errado e payload
    // sem nenhum evento. "enviado" aqui significa "aceito na porta", não
    // "contabilizado". Quem responde se o evento vale é a validação abaixo.
    console.log(`[Conversao:GA4] purchase enviado http=${r.status} transaction_id=${p.transactionId}`);
    const validacao = await validarPayloadGa4(measurementId, apiSecret, corpo, p.transactionId);
    // Registrado DEPOIS da validacao: o veredito e parte do registro, senao o
    // diagnostico so saberia que houve 204 — que nao significa nada.
    await markConversionSent({
      transactionId: p.transactionId,
      destino: "ga4",
      httpStatus: r.status,
      resultado: validacao.ok ? "ok" : "falha",
      validacaoGa4: validacao,
      rotaOrigem: p.rotaOrigem,
      provider: p.provider,
    });
    return "enviado";
  } catch (err) {
    // Sem resposta do servidor: NÃO marca. Erro de rede pode significar que o
    // hit nunca chegou, e aí a próxima tentativa precisa poder acontecer.
    console.error("[Conversao:GA4] falhou:", (err as Error)?.message);
    return "falhou";
  }
}

/** Meta Purchase via Conversions API. `event_id` = mesmo identificador canônico. */
async function enviarMeta(p: ConversaoParams): Promise<"enviado" | "pulado" | "falhou"> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.log(
      `[Conversao:Meta] pulado transaction_id=${p.transactionId} — ` +
        `META_PIXEL_ID=${pixelId ? "ok" : "AUSENTE"} ` +
        `META_CAPI_ACCESS_TOKEN=${token ? "ok" : "AUSENTE"}`,
    );
    await markConversionSent({
      transactionId: p.transactionId,
      destino: "meta",
      httpStatus: null,
      resultado: "pulado_sem_credencial",
      rotaOrigem: p.rotaOrigem,
      provider: p.provider,
    });
    return "pulado";
  }

  if (await conversionAlreadySent(p.transactionId, "meta")) {
    console.log(`[Conversao:Meta] já enviado antes, pulando event_id=${p.transactionId}`);
    return "pulado";
  }

  const userData: Record<string, unknown> = {};
  if (p.fbp) userData.fbp = p.fbp;
  if (p.fbc) userData.fbc = p.fbc;
  if (p.email) userData.em = [sha256(p.email)];
  if (p.phone) userData.ph = [sha256(p.phone.replace(/\D/g, ""))];
  if (p.clientIpAddress) userData.client_ip_address = p.clientIpAddress;
  if (p.clientUserAgent) userData.client_user_agent = p.clientUserAgent;

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(
      token,
    )}`;
    const r = await postJson(url, {
      // Simulação: o evento aparece em "Testar eventos" e NÃO entra em
      // relatório nem em otimização de campanha.
      ...(p.modoTeste ? { test_event_code: p.modoTeste.metaTestEventCode } : {}),
      data: [
        {
          event_name: "Purchase",
          // event_id igual ao do navegador: é o que faz o Meta descartar a
          // duplicata quando o pixel do cliente também reporta a mesma compra.
          event_id: p.transactionId,
          event_time: p.eventTimeSegundos ?? Math.floor(Date.now() / 1000),
          action_source: "website",
          user_data: userData,
          custom_data: {
            value: p.value,
            currency: p.currency,
            content_type: "product",
            contents: p.items.map((i) => ({
              id: i.item_id,
              quantity: i.quantity ?? 1,
              item_price: i.price,
            })),
          },
        },
      ],
    });
    await markConversionSent({
      transactionId: p.transactionId,
      destino: "meta",
      httpStatus: r.status,
      resultado: r.ok ? "ok" : "falha",
      rotaOrigem: p.rotaOrigem,
      provider: p.provider,
    });
    if (!r.ok) {
      console.error(`[Conversao:Meta] falhou http=${r.status} event_id=${p.transactionId}`);
      return "falhou";
    }
    console.log(`[Conversao:Meta] Purchase enviado event_id=${p.transactionId}`);
    return "enviado";
  } catch (err) {
    console.error("[Conversao:Meta] falhou:", (err as Error)?.message);
    return "falhou";
  }
}

/**
 * Dispara as duas conversões. Nunca lança — o chamador está num caminho onde a
 * reserva já foi paga e criada, e nada aqui pode alterar esse desfecho.
 */
export async function enviarConversaoServidor(
  p: ConversaoParams,
): Promise<{ ga4: string; meta: string }> {
  // Marco de entrada, sempre em nível `log`. Sem ele, um envio que morre antes
  // de qualquer branch não deixa rastro nenhum, e a pergunta "a conversão foi
  // tentada?" fica sem resposta — foi exatamente o que aconteceu com o GA4.
  console.log(
    `[Conversao] inicio transaction_id=${p.transactionId} value=${p.value} ${p.currency} ` +
      `gaClientId=${p.gaClientId ? "presente" : "ausente"} fbp=${p.fbp ? "presente" : "ausente"}`,
  );
  try {
    const [ga4, meta] = await Promise.all([enviarGa4(p), enviarMeta(p)]);
    console.log(`[Conversao] fim transaction_id=${p.transactionId} ga4=${ga4} meta=${meta}`);
    return { ga4, meta };
  } catch (err) {
    console.error("[Conversao] exceção inesperada (ignorada):", (err as Error)?.message);
    return { ga4: "falhou", meta: "falhou" };
  }
}

/**
 * Conversão de uma reserva confirmada — ponto de entrada ÚNICO das rotas de
 * pagamento.
 *
 * Existe porque o disparo morava dentro de `/api/payments/braspag/credit`. A
 * rota Cielo (`/api/payments/credit`), que é o caminho de produção hoje, nunca
 * recebeu a instrumentação: reserva criada, cliente cobrado, nenhuma conversão
 * registrada. Enquanto o disparo for código dentro de uma rota, a próxima rota
 * de pagamento nasce com o mesmo buraco.
 *
 * Nunca lança: a reserva já está paga e criada quando isto roda.
 */
export async function enviarConversaoReserva(params: {
  /** Número da reserva no Hostaway — o identificador canônico. */
  reservationId: number | string;
  value: number;
  currency?: string;
  items: ConversaoItem[];
  provider: "cielo" | "braspag";
  gaClientId?: string;
  gaSessionId?: string;
  fbp?: string;
  fbc?: string;
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  timestampMicros?: number;
  eventTimeSegundos?: number;
  /** Caminho que criou a reserva. Aparece em /api/admin/diagnostico. */
  rotaOrigem?: RotaOrigemConversao;
  /** Simulação: marca o evento como teste nas duas plataformas. */
  modoTeste?: { metaTestEventCode: string };
}): Promise<{ ga4: string; meta: string }> {
  const transactionId = String(params.reservationId);
  console.log(`[Conversao] reserva=${transactionId} provider=${params.provider}`);
  return enviarConversaoServidor({
    transactionId,
    value: params.value,
    currency: params.currency || "BRL",
    items: params.items,
    gaClientId: params.gaClientId,
    gaSessionId: params.gaSessionId,
    fbp: params.fbp,
    fbc: params.fbc,
    email: params.email,
    phone: params.phone,
    clientIpAddress: params.clientIpAddress,
    clientUserAgent: params.clientUserAgent,
    timestampMicros: params.timestampMicros,
    eventTimeSegundos: params.eventTimeSegundos,
    rotaOrigem: params.rotaOrigem,
    provider: params.provider,
    modoTeste: params.modoTeste,
  });
}

/** Monta os `items[]` da conversão a partir do draft, sem recalcular preço. */
export function itensDaReserva(draft: {
  propertyId: string;
  propertyName: string;
  pacoteId?: string;
  pacoteNome?: string;
  packageSlug?: string;
  packageName?: string;
  finalTotal: number;
}): ConversaoItem[] {
  const idPacote = draft.pacoteId || draft.packageSlug;
  const nomePacote = draft.pacoteNome || draft.packageName;
  if (idPacote && nomePacote) {
    return [{ item_id: idPacote, item_name: nomePacote, price: draft.finalTotal, quantity: 1 }];
  }
  return [
    { item_id: draft.propertyId, item_name: draft.propertyName, price: draft.finalTotal, quantity: 1 },
  ];
}
