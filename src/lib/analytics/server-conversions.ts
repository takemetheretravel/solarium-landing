import crypto from "crypto";

/**
 * Envio de conversão server-side (GA4 Measurement Protocol + Meta CAPI).
 *
 * Regras que este módulo NUNCA quebra:
 *  - Variável de ambiente ausente → pula em silêncio, com aviso em nível warn.
 *  - Qualquer falha (rede, token, 4xx) é engolida: analytics jamais derruba uma
 *    reserva já paga.
 *  - A idempotência NÃO mora aqui. Quem chama já passou pela guarda do
 *    webhook_events; este módulo só executa o envio.
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
  fbp?: string;
  fbc?: string;
  /** Usados só como dado hasheado no Meta CAPI (nunca em claro no log). */
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
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

/** GA4 purchase via Measurement Protocol. */
async function enviarGa4(p: ConversaoParams): Promise<"enviado" | "pulado" | "falhou"> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    console.warn("[Conversao:GA4] pulado — GA4_MEASUREMENT_ID/GA4_API_SECRET não definidos.");
    return "pulado";
  }
  // Sem client_id o GA4 aceita o hit mas não o liga a nenhuma sessão. Um valor
  // derivado do transaction_id mantém o evento contável e estável entre reenvios.
  const clientId = p.gaClientId || `server.${sha256(p.transactionId).slice(0, 16)}`;

  try {
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      measurementId,
    )}&api_secret=${encodeURIComponent(apiSecret)}`;
    const r = await postJson(url, {
      client_id: clientId,
      non_personalized_ads: false,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: p.transactionId,
            value: p.value,
            currency: p.currency,
            items: p.items.map((i) => ({
              item_id: i.item_id,
              item_name: i.item_name,
              price: i.price,
              quantity: i.quantity ?? 1,
            })),
          },
        },
      ],
    });
    if (!r.ok) {
      console.error(`[Conversao:GA4] falhou http=${r.status} transaction_id=${p.transactionId}`);
      return "falhou";
    }
    console.log(`[Conversao:GA4] purchase enviado transaction_id=${p.transactionId}`);
    return "enviado";
  } catch (err) {
    console.error("[Conversao:GA4] falhou:", (err as Error)?.message);
    return "falhou";
  }
}

/** Meta Purchase via Conversions API. `event_id` = mesmo identificador canônico. */
async function enviarMeta(p: ConversaoParams): Promise<"enviado" | "pulado" | "falhou"> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.warn("[Conversao:Meta] pulado — META_PIXEL_ID/META_CAPI_ACCESS_TOKEN não definidos.");
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
      data: [
        {
          event_name: "Purchase",
          // event_id igual ao do navegador: é o que faz o Meta descartar a
          // duplicata quando o pixel do cliente também reporta a mesma compra.
          event_id: p.transactionId,
          event_time: Math.floor(Date.now() / 1000),
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
  try {
    const [ga4, meta] = await Promise.all([enviarGa4(p), enviarMeta(p)]);
    return { ga4, meta };
  } catch (err) {
    console.error("[Conversao] exceção inesperada (ignorada):", (err as Error)?.message);
    return { ga4: "falhou", meta: "falhou" };
  }
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
