import { cacheGet, cacheSet, cacheClear, cacheDelete } from "./hostaway-cache";

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

async function getAccessToken(forceRefresh = false): Promise<string | null> {
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
    console.error(`[Hostaway] ${opts.method ?? "GET"} ${path} erro:`, (err as Error).message);
    return null;
  }
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
export async function calculatePriceDetailed(
  id: number,
  checkin: string,
  checkout: string,
  guests: number,
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

  const firstDayMin = days[0]?.minimumStay ?? 1;
  if (nights < firstDayMin) {
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
): Promise<HostawayPriceQuote | null> {
  const r = await calculatePriceDetailed(id, checkin, checkout, guests);
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

export async function createHostawayReservation(params: {
  listingMapId: number;
  arrivalDate: string;
  departureDate: string;
  numberOfGuests: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  phone: string;
  totalPrice: number;
  currency: string;
  notes?: string;
  source?: string;
}): Promise<{ reservationId: number } | null> {
  try {
    const token = await getAccessToken();
    if (!token) return null;

    const body = {
      channelId: 2013,
      channelName: "bookingengine",
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
      guestFirstName: params.guestFirstName,
      guestLastName: params.guestLastName,
      guestEmail: params.guestEmail,
      phone: params.phone,
      totalPrice: Math.round(params.totalPrice),
      currency: params.currency || "BRL",
      isPaid: true,
      paymentStatus: "Paid",
      guestNote: params.notes || "",
      status: "confirmed",
    };

    console.log("[Hostaway:createReservation] Body sent:", JSON.stringify(body));

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
    console.log("[Hostaway:createReservation] Response:", res.status, JSON.stringify(data).slice(0, 800));

    if (!res.ok) {
      console.error("[Hostaway:createReservation] Error:", res.status, JSON.stringify(data).slice(0, 500));
      return null;
    }

    console.log("[Hostaway:createReservation] Created:", data.result?.id);
    return { reservationId: data.result?.id as number };
  } catch (err) {
    console.error("[Hostaway:createReservation] Exception:", err);
    return null;
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
