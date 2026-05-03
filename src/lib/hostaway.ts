const BASE_URL = process.env.HOSTAWAY_API_BASE_URL || "https://api.hostaway.com/v1";
const ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID || "";
const API_KEY = process.env.HOSTAWAY_API_KEY || "";

export const REVALIDATE_LISTINGS = 300;
export const REVALIDATE_CALENDAR = 300;

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

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!ACCOUNT_ID || !API_KEY) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
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
      console.error("[hostaway] token request failed:", res.status, res.statusText);
      return null;
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return cachedToken.value;
  } catch (err) {
    console.error("[hostaway] token request error:", (err as Error).message);
    return null;
  }
}

type FetchOpts = { revalidate?: number; method?: string; body?: unknown };

async function authFetch<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.revalidate !== undefined
        ? { next: { revalidate: opts.revalidate } }
        : { next: { revalidate: 0 } }),
    };

    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      console.error(`[hostaway] ${opts.method ?? "GET"} ${path} failed:`, res.status);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[hostaway] ${opts.method ?? "GET"} ${path} error:`, (err as Error).message);
    return null;
  }
}

export async function getListings(): Promise<HostawayListing[]> {
  const json = await authFetch<{ result?: HostawayListing[] }>(
    "/listings?limit=20",
    { revalidate: REVALIDATE_LISTINGS },
  );
  return json?.result ?? [];
}

export async function getListing(id: number): Promise<HostawayListing | null> {
  const json = await authFetch<{ result?: HostawayListing }>(
    `/listings/${id}?includeResources=1`,
    { revalidate: REVALIDATE_LISTINGS },
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
    { revalidate: REVALIDATE_CALENDAR },
  );
  return json?.result ?? [];
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
