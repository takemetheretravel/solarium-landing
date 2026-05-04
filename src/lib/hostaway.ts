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
  currency: string;
  nights: number;
  averageNightly: number;
  raw: unknown;
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

export async function calculatePrice(
  id: number,
  checkin: string,
  checkout: string,
  guests: number,
): Promise<HostawayPriceQuote | null> {
  const json = await authFetch<{ result?: Record<string, unknown> }>(
    `/listings/${id}/calendarPriceCalculator`,
    {
      method: "POST",
      body: {
        startingDate: checkin,
        endingDate: checkout,
        numberOfGuests: guests,
        version: 2,
      },
    },
  );
  if (!json?.result) return null;
  const r = json.result as Record<string, number | string>;
  const totalPrice = Number(r.totalPrice ?? r.totalAmount ?? 0);
  const baseTotal = Number(r.baseTotalPrice ?? r.totalRent ?? totalPrice);
  const discount = Number(r.discount ?? r.totalDiscount ?? 0);
  const cleaningFee = Number(r.cleaningFee ?? 0);
  const nights = nightsBetween(checkin, checkout);
  return {
    totalPrice,
    baseTotal,
    discount,
    cleaningFee,
    currency: String(r.currency ?? r.currencyCode ?? "BRL"),
    nights,
    averageNightly: nights > 0 ? totalPrice / nights : 0,
    raw: json.result,
  };
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
