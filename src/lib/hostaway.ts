import { cacheGet, cacheSet, cacheClear, cacheDelete } from "./hostaway-cache";
import { mensagemChegadaBloqueada } from "./pricing/mensagem-chegada";

const BASE_URL = process.env.HOSTAWAY_API_BASE_URL || "https://api.hostaway.com/v1";
const ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID || "";
const API_KEY = process.env.HOSTAWAY_API_KEY || "";

export const REVALIDATE_LISTINGS = 300;
export const REVALIDATE_CALENDAR = 60;

export type HostawayListing = {
  id: number;
  name: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  price?: number | null;
  cleaningFee?: number | null;
  currencyCode?: string | null;
  personCapacity?: number | null;
  bedroomsNumber?: number | null;
  bedsNumber?: number | null;
  bathroomsNumber?: number | null;
  minNights?: number | null;
  maxNights?: number | null;
  averageNightlyPrice?: number | null;
  cancellationPolicy?: string | null;
  listingAmenities?: { id: number; amenityId: number; amenityName: string }[];
  listingImages?: { id: number; url: string; sortOrder: number; caption?: string | null }[];
};

export type HostawayCalendarDay = {
  date: string;
  isAvailable: 0 | 1;
  status: string;
  price: number;
  minimumStay: number;
  maximumStay?: number | null;
  closedOnArrival?: 0 | 1 | null;
  closedOnDeparture?: 0 | 1 | null;
  countAvailableUnits: number;
};

export type HostawayPriceQuote = {
  totalPrice: number;
  baseTotal: number;
  discount: number;
  cleaningFee: number;
  extraGuestFee: number;
  currency: string;
  nights: number;
  averageNightly: number;
  source: "calendar-sum";
  raw: unknown;
};

export type HostawayPriceFailure = {
  reason:
    | "missing-data"
    | "unavailable-day"
    | "min-stay-not-met"
    | "max-stay-exceeded"
    | "closed-on-arrival"
    | "api-error";
  message: string;
  meta?: Record<string, unknown>;
};

type TokenInfo = { value: string; expiresAt: number; obtainedAt: number };
const TOKEN_CACHE_KEY = "hostaway:accessToken";

export type HostawayDiagnostic = {
  hasCredentials: boolean;
  tokenStatus: "ok" | "missing" | "error";
  tokenObtainedAt?: string;
  tokenExpiresAt?: string;
  lastError?: string;
};

let lastDiagnostic: HostawayDiagnostic = {
  hasCredentials: Boolean(ACCOUNT_ID && API_KEY),
  tokenStatus: "missing",
};

export function getDiagnostic(): HostawayDiagnostic {
  return { ...lastDiagnostic };
}

async function fetchAccessToken(): Promise<TokenInfo | null> {
  if (!ACCOUNT_ID || !API_KEY) {
    lastDiagnostic = { hasCredentials: false, tokenStatus: "missing" };
    console.error("[Hostaway] Credenciais ausentes em .env.local");
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: ACCOUNT_ID,
      client_secret: API_KEY,
      scope: "general",
    });

    const res = await fetch(`${BASE_URL}/accessTokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body,
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      lastDiagnostic = {
        hasCredentials: true,
        tokenStatus: "error",
        lastError: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
      console.error("[Hostaway] Falha ao gerar token:", res.status, errText.slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    const now = Date.now();
    const info: TokenInfo = {
      value: json.access_token,
      expiresAt: now + json.expires_in * 1000,
      obtainedAt: now,
    };
    lastDiagnostic = {
      hasCredentials: true,
      tokenStatus: "ok",
      tokenObtainedAt: new Date(now).toISOString(),
      tokenExpiresAt: new Date(info.expiresAt).toISOString(),
    };
    console.log(
      `[Hostaway] Token gerado, válido até ${new Date(info.expiresAt).toISOString()}`,
    );
    return info;
  } catch (err) {
    const msg = (err as Error).message;
    lastDiagnostic = { hasCredentials: true, tokenStatus: "error", lastError: msg };
    console.error("[Hostaway] Erro ao gerar token:", msg);
    return null;
  }
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = cacheGet<TokenInfo>(TOKEN_CACHE_KEY);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.value;
    }
  }
  const info = await fetchAccessToken();
  if (!info) return null;
  const ttl = Math.max(60, Math.floor((info.expiresAt - Date.now()) / 1000) - 60);
  cacheSet(TOKEN_CACHE_KEY, info, Math.min(ttl, 86400));
  return info.value;
}

export function clearTokenCache(): void {
  cacheDelete(TOKEN_CACHE_KEY);
  console.log("[Hostaway] Token cache limpo manualmente");
}

export function clearAllCache(): number {
  return cacheClear("hostaway:");
}

type FetchOpts = {
  method?: string;
  body?: unknown;
  cacheKey?: string;
  ttlSeconds?: number;
};

/**
 * Erros de REDE que valem nova tentativa. A causa costuma vir aninhada em
 * `err.cause.code` no fetch do Node, então olhamos os dois níveis.
 */
const CODIGOS_DE_REDE = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN"];

function ehErroDeRede(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  const code = e?.code || e?.cause?.code;
  if (code && CODIGOS_DE_REDE.includes(code)) return true;
  const msg = e?.message || "";
  return CODIGOS_DE_REDE.some((c) => msg.includes(c)) || /fetch failed|socket hang up/i.test(msg);
}

/** 300ms → 900ms → 2700ms. Três tentativas no total. */
const ATRASOS_RETRY = [300, 900, 2700];

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function authFetch<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  if (opts.cacheKey) {
    const hit = cacheGet<T>(opts.cacheKey);
    if (hit !== undefined) return hit;
  }

  const doRequest = async (token: string): Promise<Response> => {
    const isMutation = (opts.method ?? "GET") !== "GET";
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      ...(isMutation
        ? { cache: "no-store" as RequestCache }
        : { next: { revalidate: opts.ttlSeconds ?? 60 } }),
    };
    return fetch(`${BASE_URL}${path}`, init);
  };

  // Retry com backoff exponencial: 300ms / 900ms / 2700ms.
  //
  // Só para erro de REDE e 5xx. Um 4xx é resposta definitiva do servidor —
  // repetir não muda nada e ainda multiplica a carga. O 401/403 continua com o
  // tratamento próprio (regenerar token), que não é retry.
  //
  // Motivo: dois ECONNRESET contra a Hostaway derrubaram o preço de uma página
  // de pacote, e ela respondeu 200 sem preço nenhum. A tentativa aqui resolve a
  // falha transitória; o que não resolver, o chamador precisa tratar como
  // indisponibilidade explícita (nunca renderizar preço a partir de null).
  for (let tentativa = 0; tentativa < ATRASOS_RETRY.length; tentativa++) {
    const ehUltima = tentativa === ATRASOS_RETRY.length - 1;
    try {
      let token = await getAccessToken();
      if (!token) return null;

      let res = await doRequest(token);

      if (res.status === 401 || res.status === 403) {
        console.warn(`[Hostaway] ${res.status} em ${path} — regenerando token e tentando novamente`);
        token = await getAccessToken(true);
        if (!token) return null;
        res = await doRequest(token);
      }

      if (res.status >= 500 && !ehUltima) {
        console.warn(
          `[Hostaway] ${path} HTTP ${res.status} — nova tentativa em ${ATRASOS_RETRY[tentativa]}ms`,
        );
        await esperar(ATRASOS_RETRY[tentativa]);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[Hostaway] ${opts.method ?? "GET"} ${path} falhou:`, res.status, errText.slice(0, 200));
        return null;
      }
      const json = (await res.json()) as T;
      if (opts.cacheKey && opts.ttlSeconds) {
        cacheSet(opts.cacheKey, json, opts.ttlSeconds);
      }
      return json;
    } catch (err) {
      if (ehErroDeRede(err) && !ehUltima) {
        console.warn(
          `[Hostaway] ${path} erro de rede (${(err as Error).message}) — nova tentativa em ${ATRASOS_RETRY[tentativa]}ms`,
        );
        await esperar(ATRASOS_RETRY[tentativa]);
        continue;
      }
      console.error(`[Hostaway] ${opts.method ?? "GET"} ${path} erro:`, (err as Error).message);
      return null;
    }
  }
  console.error(`[Hostaway] ${opts.method ?? "GET"} ${path} esgotou as tentativas`);
  return null;
}

export async function getListings(): Promise<HostawayListing[]> {
  const json = await authFetch<{ result?: HostawayListing[] }>("/listings?limit=20", {
    cacheKey: "hostaway:listings",
    ttlSeconds: REVALIDATE_LISTINGS,
  });
  const result = json?.result ?? [];
  console.log(`[Hostaway] Listings retornadas: ${result.length}`);
  return result;
}

export async function getListing(id: number): Promise<HostawayListing | null> {
  const json = await authFetch<{ result?: HostawayListing }>(
    `/listings/${id}?includeResources=1`,
    { cacheKey: `hostaway:listing:${id}`, ttlSeconds: REVALIDATE_LISTINGS },
  );
  return json?.result ?? null;
}

export async function getCalendar(
  id: number,
  startDate: string,
  endDate: string,
): Promise<HostawayCalendarDay[]> {
  const json = await authFetch<{ result?: HostawayCalendarDay[] }>(
    `/listings/${id}/calendar?startDate=${startDate}&endDate=${endDate}`,
    {
      cacheKey: `hostaway:calendar:${id}:${startDate}:${endDate}`,
      ttlSeconds: REVALIDATE_CALENDAR,
    },
  );
  return json?.result ?? [];
}

export async function getCombinedCalendar(
  ids: number[],
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; anyAvailable: boolean; anyArrival: boolean; minPrice: number | null }>> {
  const all = await Promise.all(ids.map((id) => getCalendar(id, startDate, endDate)));
  const map = new Map<string, { anyAvailable: boolean; anyArrival: boolean; minPrice: number | null }>();
  for (const days of all) {
    for (const d of days) {
      const cur = map.get(d.date) ?? { anyAvailable: false, anyArrival: false, minPrice: null };
      const available = d.isAvailable === 1;
      const arrival = available && d.closedOnArrival !== 1;
      cur.anyAvailable = cur.anyAvailable || available;
      cur.anyArrival = cur.anyArrival || arrival;
      if (available && Number.isFinite(d.price) && d.price > 0) {
        cur.minPrice = cur.minPrice === null ? d.price : Math.min(cur.minPrice, d.price);
      }
      map.set(d.date, cur);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}

/**
 * Hostaway no longer exposes /calendarPriceCalculator (404 em maio/2026).
 * Probamos também /priceDetails, /priceCalculator, /reservations/calculator — todos 404.
 *
 * Abordagem que funciona: somar `price` diário do GET /calendar
 * (que já reflete pricing dinâmico) + cleaningFee + extra-guest fee da própria listing.
 * Diários do Hostaway costumam vir já líquidos de descontos por temporada.
 */
export type OpcoesPreco = {
  /**
   * Ignora o mínimo de noites da data de chegada.
   *
   * O mínimo é regra de canal, configurada no PMS. Um pacote pode ter permissão
   * explícita para vender abaixo dele no canal direto — nunca por padrão, e
   * nunca para reserva avulsa. Ver `ignorarMinimoPMS` em `precos-e-extras.ts`.
   *
   * A tarifa continua vindo inteira do calendário: o que muda é a recusa, não o
   * preço.
   */
  ignorarMinimoDeNoites?: boolean;
};

export async function calculatePriceDetailed(
  id: number,
  checkin: string,
  checkout: string,
  guests: number,
  opcoes: OpcoesPreco = {},
): Promise<{ quote: HostawayPriceQuote } | { failure: HostawayPriceFailure }> {
  const nights = nightsBetween(checkin, checkout);
  if (nights <= 0) {
    return { failure: { reason: "missing-data", message: "Datas inválidas (check-in deve ser anterior ao check-out)." } };
  }

  // Calendar é inclusivo nas duas pontas. Para N noites a partir de checkin, pegamos
  // checkin .. (checkout - 1 dia). Estes são os dias com cobrança (a noite estendida cobre o dia seguinte).
  const lastNight = (() => {
    const d = new Date(checkout + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const days = await getCalendar(id, checkin, lastNight);
  if (!days || days.length === 0) {
    console.error(`[Hostaway:price] Calendar vazio para listing ${id} (${checkin}..${lastNight})`);
    return { failure: { reason: "api-error", message: "Não foi possível ler o calendário no momento." } };
  }
  if (days.length !== nights) {
    console.warn(`[Hostaway:price] Calendar retornou ${days.length} dias, esperava ${nights}`);
  }

  const blocked = days.find((d) => d.isAvailable !== 1);
  if (blocked) {
    return {
      failure: {
        reason: "unavailable-day",
        message: `A data ${blocked.date} está reservada.`,
        meta: { date: blocked.date, status: blocked.status },
      },
    };
  }

  // CHEGADA fechada no PMS (`closedOnArrival`).
  //
  // A noite pode estar livre e a chegada, proibida — são coisas diferentes, e
  // enquanto só a primeira era checada o site vendia entrada num dia que a
  // Hostaway recusa. A restrição vale SÓ para o primeiro dia: passar por cima
  // de um domingo no meio da estadia continua permitido.
  const primeiroDia = days.find((d) => d.date === checkin) ?? days[0];
  if (primeiroDia?.closedOnArrival === 1) {
    return {
      failure: {
        reason: "closed-on-arrival",
        message: mensagemChegadaBloqueada(checkin),
        meta: { date: checkin },
      },
    };
  }

  const firstDayMin = days[0]?.minimumStay ?? 1;
  if (nights < firstDayMin && !opcoes.ignorarMinimoDeNoites) {
    return {
      failure: {
        reason: "min-stay-not-met",
        message: `Esta data exige no mínimo ${firstDayMin} noites.`,
        meta: { minimumStay: firstDayMin, requested: nights },
      },
    };
  }

  const baseTotal = days.reduce((sum, d) => sum + (Number.isFinite(d.price) ? d.price : 0), 0);

  const listing = await getListing(id);
  const cleaningFee = Number(listing?.cleaningFee ?? 0);
  const guestsIncluded = Number((listing as Record<string, unknown>)?.["guestsIncluded"] ?? 2);
  const priceForExtraPerson = Number((listing as Record<string, unknown>)?.["priceForExtraPerson"] ?? 0);

  const extraGuests = Math.max(0, guests - guestsIncluded);
  const extraGuestFee = extraGuests * priceForExtraPerson * nights;

  const totalPrice = baseTotal + cleaningFee + extraGuestFee;

  console.log(
    `[Hostaway:price] listing=${id} nights=${nights} guests=${guests} baseTotal=${baseTotal} cleaning=${cleaningFee} extra=${extraGuestFee} total=${totalPrice}`,
  );

  return {
    quote: {
      totalPrice,
      baseTotal,
      discount: 0,
      cleaningFee,
      extraGuestFee,
      currency: String(listing?.currencyCode ?? "BRL"),
      nights,
      averageNightly: totalPrice / nights,
      source: "calendar-sum",
      raw: { days, listingFees: { cleaningFee, guestsIncluded, priceForExtraPerson } },
    },
  };
}

export async function calculatePrice(
  id: number,
  checkin: string,
  checkout: string,
  guests: number,
  opcoes: OpcoesPreco = {},
): Promise<HostawayPriceQuote | null> {
  const r = await calculatePriceDetailed(id, checkin, checkout, guests, opcoes);
  return "quote" in r ? r.quote : null;
}

export async function getChannels(): Promise<unknown[]> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${BASE_URL}/channels`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
      },
    });
    const data = await res.json();
    console.log("[Hostaway:channels]", JSON.stringify(data?.result?.slice(0, 10)));
    return data?.result || [];
  } catch (err) {
    console.error("[Hostaway:getChannels]", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// CUSTOM FIELDS
// ---------------------------------------------------------------------------

const CUSTOM_FIELDS_CACHE_KEY = "hostaway:customFields";

/**
 * Nomes que procuramos na conta. Se o campo não existir, o valor cai no hostNote
 * estruturado — o registro nunca se perde por falta de configuração na Hostaway.
 */
const CAMPOS_DESEJADOS = {
  pacote: ["Pacote", "Package"],
  extras: ["Extras", "Extras a providenciar"],
  cancelamento: ["Cancelamento de extras", "Data limite cancelamento extras"],
};

type CustomField = { id: number; name: string };

async function getCustomFields(): Promise<CustomField[]> {
  const cached = cacheGet<CustomField[]>(CUSTOM_FIELDS_CACHE_KEY);
  if (cached) return cached;

  try {
    const token = await getAccessToken();
    if (!token) return [];
    const res = await fetch(`${BASE_URL}/customFields`, {
      headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      console.warn("[Hostaway:customFields] HTTP", res.status, "— usando hostNote como registro");
      cacheSet(CUSTOM_FIELDS_CACHE_KEY, [], 600);
      return [];
    }
    const data = await res.json();
    const campos: CustomField[] = (data?.result ?? [])
      .map((c: Record<string, unknown>) => ({ id: Number(c.id), name: String(c.name ?? "") }))
      .filter((c: CustomField) => Number.isFinite(c.id) && c.name);

    console.log("[Hostaway:customFields] encontrados:", campos.map((c) => `${c.id}:${c.name}`).join(", ") || "nenhum");
    cacheSet(CUSTOM_FIELDS_CACHE_KEY, campos, 3600);
    return campos;
  } catch (err) {
    console.error("[Hostaway:customFields]", err);
    return [];
  }
}

function acharCampo(campos: CustomField[], nomes: string[]): number | null {
  const alvo = nomes.map((n) => n.toLowerCase());
  const achado = campos.find((c) => alvo.includes(c.name.trim().toLowerCase()));
  return achado ? achado.id : null;
}

async function montarCustomFieldValues(dados: {
  pacote?: string;
  extras?: { nome: string; qtd: number; total: number; incluso: boolean }[];
  dataLimiteCancelamentoExtras?: string;
}): Promise<{ customFieldId: number; value: string }[]> {
  if (!dados.pacote && !dados.extras?.length && !dados.dataLimiteCancelamentoExtras) return [];

  const campos = await getCustomFields();
  if (campos.length === 0) return [];

  const valores: { customFieldId: number; value: string }[] = [];

  const idPacote = acharCampo(campos, CAMPOS_DESEJADOS.pacote);
  if (idPacote && dados.pacote) valores.push({ customFieldId: idPacote, value: dados.pacote });

  const idExtras = acharCampo(campos, CAMPOS_DESEJADOS.extras);
  if (idExtras && dados.extras?.length) {
    valores.push({
      customFieldId: idExtras,
      value: dados.extras
        .map((e) => `${e.qtd}× ${e.nome} — R$ ${e.total.toFixed(2)}${e.incluso ? " (incluso)" : ""}`)
        .join("\n"),
    });
  }

  const idCancel = acharCampo(campos, CAMPOS_DESEJADOS.cancelamento);
  if (idCancel && dados.dataLimiteCancelamentoExtras) {
    valores.push({ customFieldId: idCancel, value: dados.dataLimiteCancelamentoExtras });
  }

  if (valores.length === 0) {
    console.warn(
      "[Hostaway:customFields] nenhum campo compatível na conta — registro segue apenas no hostNote",
    );
  }
  return valores;
}

export async function createHostawayReservation(params: {
  listingMapId: number;
  arrivalDate: string;
  departureDate: string;
  numberOfGuests: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  phone: string;
  totalPrice: number;        // valor REAL cobrado (com desconto e com juros)
  subtotalOriginal?: number; // valor cheio antes do desconto (para mostrar na nota)
  discountAmount?: number;
  couponCode?: string;
  installments?: number;
  paymentMethod?: "pix" | "card";
  currency?: string;
  guestNotes?: string;       // observações do hóspede (não confundir com hostNote)
  source?: string;
  packageName?: string;      // nome do pacote, se a reserva veio de /pacotes
  subtotalPacote?: number;
  descontoPacote?: number;
  extrasList?: string[];     // extras do pacote (para o concierge preparar)
  shortNotice?: boolean;     // check-in < 3 dias: parceiros precisam ser acionados já
  serviceExtras?: { id: string; label: string; qty: number; price: number; note?: string }[]; // massagem/cestas a acionar
  opExtras?: { type: string; label: string; price: number; blockedNight: string }[]; // early/late: noite adjacente bloqueada
  // --- Pacotes V2 ---
  pacoteNome?: string;
  /** Linhas de extras do pacote, já revalidadas. Vão ao campo estruturado. */
  pacoteItens?: { extraId: string; nome: string; qtd: number; total: number; incluso: boolean }[];
  /** Data-limite de cancelamento dos extras com reembolso integral (ISO). */
  dataLimiteCancelamentoExtras?: string;
  /** Reserva vinda do preview de teste — marcação explícita para a equipe. */
  reservaTeste?: boolean;
}): Promise<{ reservationId: number } | null> {
  try {
    const token = await getAccessToken();
    if (!token) return null;

    // Telefone: garante prefixo +55 só se ainda não tiver +
    let phone = (params.phone || "").trim();
    if (!phone.startsWith("+")) {
      const digits = phone.replace(/\D/g, "");
      phone = "+" + (digits.length <= 11 ? "55" + digits : digits);
    }

    // hostNote (privado, só anfitrião vê): detalhamento financeiro
    const hostNoteParts: string[] = [];
    if (params.shortNotice) {
      hostNoteParts.push("⚠️ URGENTE — RESERVA COM MENOS DE 3 DIAS: acionar parceiros imediatamente");
    }
    if (params.subtotalOriginal && params.subtotalOriginal !== params.totalPrice) {
      hostNoteParts.push(`Subtotal: R$ ${params.subtotalOriginal.toFixed(2)}`);
    }
    if (params.discountAmount && params.discountAmount > 0) {
      hostNoteParts.push(
        `Desconto${params.couponCode ? ` (${params.couponCode})` : ""}: -R$ ${params.discountAmount.toFixed(2)}`,
      );
    }
    hostNoteParts.push(
      `Pagamento: ${params.paymentMethod === "pix" ? "Pix" : `Cartão ${params.installments || 1}x`}`,
    );
    hostNoteParts.push(`Valor cobrado: R$ ${params.totalPrice.toFixed(2)}`);
    // Pacote V2: uma linha por item, com quantidade e valor, mais subtotal,
    // desconto e a data-limite de cancelamento. A equipe precisa saber o que
    // preparar sem abrir o site.
    if (params.pacoteNome) {
      hostNoteParts.push(`PACOTE: ${params.pacoteNome}`);
      for (const item of params.pacoteItens ?? []) {
        const marca = item.incluso ? "incluso" : "extra";
        const qtd = item.qtd > 1 ? ` x${item.qtd}` : "";
        hostNoteParts.push(`  - ${item.nome}${qtd} (${marca}): R$ ${item.total.toFixed(2)}`);
      }
      if (params.subtotalPacote !== undefined) {
        hostNoteParts.push(`Valor total dos itens: R$ ${params.subtotalPacote.toFixed(2)}`);
      }
      if (params.descontoPacote !== undefined && params.descontoPacote > 0) {
        hostNoteParts.push(`Desconto do pacote: -R$ ${params.descontoPacote.toFixed(2)}`);
      }
      if (params.dataLimiteCancelamentoExtras) {
        hostNoteParts.push(
          `Extras canceláveis com reembolso até ${params.dataLimiteCancelamentoExtras}`,
        );
      }
    }

    if (params.packageName) {
      hostNoteParts.push(
        `PACOTE: ${params.packageName}${params.extrasList?.length ? ` | Extras: ${params.extrasList.join("; ")}` : ""}`,
      );
    }
    if (params.serviceExtras?.length) {
      hostNoteParts.push(
        `EXTRAS DE SERVIÇO: ${params.serviceExtras
          .map((e) => `${e.qty}× ${e.label} (R$ ${e.price.toFixed(2)})${e.note ? ` — ${e.note}` : ""}`)
          .join("; ")}`,
      );
    }
    if (params.opExtras?.length) {
      // Dupla garantia: mesmo com bloqueio automático, registra a noite a bloquear.
      hostNoteParts.push(
        `EXTRAS OPERACIONAIS: ${params.opExtras
          .map((e) => `${e.label} (R$ ${e.price.toFixed(2)}) — noite bloqueada ${e.blockedNight}`)
          .join("; ")}`,
      );
    }
    // --- Pacotes V2 ---
    if (params.reservaTeste) {
      hostNoteParts.unshift("🧪 RESERVA DE TESTE — não operar, estornar depois");
    }
    if (params.pacoteNome) {
      hostNoteParts.push(`PACOTE: ${params.pacoteNome}`);
    }
    if (params.pacoteItens?.length) {
      // Uma entrada por item, não concatenado num blocão: a equipe precisa ler.
      hostNoteParts.push(
        `EXTRAS A PROVIDENCIAR: ${params.pacoteItens
          .map(
            (e) =>
              `${e.qtd}× ${e.nome} (R$ ${e.total.toFixed(2)}${e.incluso ? ", incluso no pacote" : ""})`,
          )
          .join("; ")}`,
      );
    }
    if (params.dataLimiteCancelamentoExtras) {
      hostNoteParts.push(
        `Extras canceláveis com reembolso até ${params.dataLimiteCancelamentoExtras}`,
      );
    }

    const hostNote = hostNoteParts.join(" | ");

    // guestNote (público, o hóspede lê): observação dele + a data-limite de
    // cancelamento dos extras escrita por extenso. Não existe e-mail de
    // confirmação próprio no site — a comunicação ao hóspede sai da Hostaway,
    // então a data precisa viajar por aqui.
    const guestNoteParts: string[] = [];
    if (params.guestNotes) guestNoteParts.push(params.guestNotes);
    if (params.dataLimiteCancelamentoExtras) {
      guestNoteParts.push(
        `Extras podem ser cancelados com reembolso integral até ${dataPorExtenso(params.dataLimiteCancelamentoExtras)}.`,
      );
    }
    const guestNote = guestNoteParts.join("\n\n");

    // Campo estruturado, quando a conta tiver os custom fields criados. Se não
    // tiver, o hostNote acima já carrega tudo — nunca ficamos sem registro.
    const customFieldValues = await montarCustomFieldValues({
      pacote: params.pacoteNome,
      extras: params.pacoteItens,
      dataLimiteCancelamentoExtras: params.dataLimiteCancelamentoExtras,
    });

    const body: Record<string, unknown> = {
      channelId: null,
      channelName: "direct",
      source: params.source || "solarium-direct",
      listingMapId: params.listingMapId,
      arrivalDate: params.arrivalDate,
      departureDate: params.departureDate,
      checkInTime: 15,
      checkOutTime: 11,
      numberOfGuests: params.numberOfGuests,
      adults: params.numberOfGuests,
      children: 0,
      infants: 0,
      guestName: `${params.guestFirstName} ${params.guestLastName}`,
      guestFirstName: params.guestFirstName,
      guestLastName: params.guestLastName,
      guestEmail: params.guestEmail,
      phone,
      totalPrice: Math.round(params.totalPrice * 100) / 100, // VALOR REAL COBRADO
      currency: params.currency || "BRL",
      isPaid: true,
      paymentStatus: "Paid",
      guestLocale: "pt",
      hostNote,
      guestNote,
      status: "confirmed",
    };

    if (customFieldValues.length > 0) {
      body.customFieldValues = customFieldValues;
    }

    console.log("[Hostaway:createReservation] Body:", JSON.stringify(body));

    const res = await fetch(`${BASE_URL}/reservations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log("[Hostaway:createReservation] Response:", res.status, JSON.stringify(data).slice(0, 300));

    if (!res.ok) {
      console.error("[Hostaway:createReservation] FAILED:", data.message);
      return null;
    }

    const reservationId = data.result?.id as number | undefined;
    if (!reservationId) return null;

    console.log("[Hostaway:createReservation] Created:", reservationId);

    // Marcação como paga não está disponível via API pública Hostaway.
    // Fluxo: receber pagamento Cielo → marcar manualmente no Hostaway (1 minuto por reserva).
    console.log("⚠️  AÇÃO MANUAL NECESSÁRIA — MARCAR RESERVA COMO PAGA NO HOSTAWAY ⚠️");
    console.log(
      JSON.stringify(
        {
          reservationId,
          dashboardUrl: `https://dashboard.hostaway.com/reservations/${reservationId}/edit`,
          valorCobrado: `R$ ${params.totalPrice.toFixed(2)}`,
          metodoPagamento: params.paymentMethod === "pix" ? "Pix" : `Cartão ${params.installments || 1}x`,
          acao:
            "Abrir reserva → Add transaction → Amount: " +
            params.totalPrice.toFixed(2) +
            " → Date: hoje → Confirmar",
        },
        null,
        2,
      ),
    );

    return { reservationId };
  } catch (err) {
    console.error("[Hostaway:createReservation] Exception:", err);
    return null;
  }
}

/**
 * Bloqueia (ou libera) uma noite no calendário de uma listing.
 * Payload confirmado em diagnóstico: PUT /listings/{id}/calendar
 * { startDate, endDate, isAvailable }. isAvailable=0 bloqueia, =1 libera.
 */
export async function blockCalendarNight(listingId: number, date: string): Promise<boolean> {
  try {
    const token = await getAccessToken();
    if (!token) return false;
    const res = await fetch(`${BASE_URL}/listings/${listingId}/calendar`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ startDate: date, endDate: date, isAvailable: 0 }),
    });
    const ok = res.ok;
    console.log(`[Hostaway:block] listing=${listingId} date=${date} → ${res.status} ${ok ? "OK" : "FALHOU"}`);
    return ok;
  } catch (e) {
    console.error("[Hostaway:block] erro:", (e as Error).message);
    return false;
  }
}

export function nightsBetween(checkin: string, checkout: string): number {
  const a = new Date(checkin + "T00:00:00Z").getTime();
  const b = new Date(checkout + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export async function getMinNightlyFromCalendar(
  id: number,
  rangeDays = 90,
): Promise<number | null> {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + rangeDays);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const days = await getCalendar(id, fmt(start), fmt(end));
  const prices = days
    .filter((d) => d.isAvailable === 1 && Number.isFinite(d.price) && d.price > 0)
    .map((d) => d.price);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** A data escrita, não a regra: "2026-09-14" → "14 de setembro". */
function dataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  if (!ano || !mes || !dia) return iso;
  return `${dia} de ${MESES_PT[mes - 1]}`;
}
