"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, Tag, MessageCircle, ArrowRight } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";

type CalendarDay = {
  date: string;
  isAvailable: boolean;
  price: number;
  minimumStay: number;
  closedOnArrival?: boolean;
  closedOnDeparture?: boolean;
};

type PriceFailure = {
  reason: "missing-data" | "unavailable-day" | "min-stay-not-met" | "max-stay-exceeded" | "api-error";
  message: string;
  meta?: Record<string, unknown>;
};

type PriceResponse = {
  ok: true;
  nights: number;
  averageNightly: number;
  cleaningFee: number;
  extraGuestFee: number;
  discount: number;
  baseTotal: number;
  hostawayTotal: number;
  coupon: { code: string; description: string; discount: number } | null;
  couponError: string | null;
  paymentMethod: string;
  pixDiscount: number;
  finalTotal: number;
  currency: string;
} | {
  ok: false;
  failure: PriceFailure;
};

type Props = {
  propertySlug: string;
  initialCheckin?: string;
  initialCheckout?: string;
  initialGuests?: number;
  maxCapacity: number;
  idealCapacity?: number;
};

const MAX_DAYS_AHEAD = 540;

function todayPlus(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISO(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function BookingForm({
  propertySlug,
  initialCheckin,
  initialCheckout,
  initialGuests = 2,
  maxCapacity,
}: Props) {
  const router = useRouter();

  // Explicit two-phase state — no reliance on DayPicker's internal range logic
  const [phase, setPhase] = useState<"checkin" | "checkout">("checkin");
  const [checkinDate, setCheckinDate] = useState<Date | undefined>(
    initialCheckin ? fromISO(initialCheckin) : undefined
  );
  const [checkoutDate, setCheckoutDate] = useState<Date | undefined>(
    initialCheckout ? fromISO(initialCheckout) : undefined
  );

  const [guests, setGuests] = useState(initialGuests);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "pix">("card");
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState("");
  const [showCoupon, setShowCoupon] = useState(false);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [response, setResponse] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Range for DayPicker visual rendering only
  const range = useMemo(() => ({ from: checkinDate, to: checkoutDate }), [checkinDate, checkoutDate]);

  useEffect(() => {
    const start = toISO(todayPlus(0));
    const end = toISO(todayPlus(MAX_DAYS_AHEAD));
    fetch(`/api/calendar?property=${propertySlug}&start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.days) setCalendarDays(data.days);
      })
      .catch(() => {});
  }, [propertySlug]);

  // Read all flags independently — no if/else that hides flags for unavailable days
  const { fullyBlockedSet, noArrivalSet, noDepartureSet, minNightsByISO } = useMemo(() => {
    const fullyBlockedSet = new Set<string>();
    const noArrivalSet = new Set<string>();
    const noDepartureSet = new Set<string>();
    const minNightsByISO = new Map<string, number>();
    for (const d of calendarDays) {
      if (!d.isAvailable) fullyBlockedSet.add(d.date);
      if (d.closedOnArrival) noArrivalSet.add(d.date);
      if (d.closedOnDeparture) noDepartureSet.add(d.date);
      minNightsByISO.set(d.date, d.minimumStay || 1);
    }
    return { fullyBlockedSet, noArrivalSet, noDepartureSet, minNightsByISO };
  }, [calendarDays]);

  function isValidCheckin(date: Date): boolean {
    const iso = toISO(date);
    const today = toISO(todayPlus(0));
    const maxDate = toISO(todayPlus(MAX_DAYS_AHEAD));
    if (iso < today || iso > maxDate) return false;
    if (fullyBlockedSet.has(iso)) return false;
    if (noArrivalSet.has(iso)) return false;
    return true;
  }

  function isValidCheckout(date: Date, from: Date): boolean {
    const iso = toISO(date);
    const maxDate = toISO(todayPlus(MAX_DAYS_AHEAD));
    if (iso > maxDate) return false;
    if (date <= from) return false;
    const minStay = minNightsByISO.get(toISO(from)) ?? 1;
    if (date < addDays(from, minStay)) return false;
    // Don't check fullyBlockedSet — isAvailable=false dates can be valid checkouts
    // (same-day turnover: our guests leave, next reservation starts same day)
    if (noDepartureSet.has(iso)) return false;
    return true;
  }

  function handleDayClick(day: Date) {
    const iso = toISO(day);
    const today = toISO(todayPlus(0));
    if (iso < today) return;

    if (phase === "checkin") {
      if (!isValidCheckin(day)) return;
      setCheckinDate(day);
      setCheckoutDate(undefined);
      setPhase("checkout");
      return;
    }

    if (!checkinDate) {
      setPhase("checkin");
      return;
    }

    if (day <= checkinDate) {
      if (isValidCheckin(day)) {
        setCheckinDate(day);
        setCheckoutDate(undefined);
        setPhase("checkout");
      }
      return;
    }

    if (!isValidCheckout(day, checkinDate)) return;
    setCheckoutDate(day);
    setPhase("checkin");
  }

  // Visual only — onDayClick handles actual logic
  const isDateDisabledVisual = useCallback((date: Date): boolean => {
    const iso = toISO(date);
    const today = toISO(todayPlus(0));
    if (iso < today) return true;

    if (phase === "checkin") {
      return fullyBlockedSet.has(iso) || noArrivalSet.has(iso);
    }

    if (checkinDate) {
      if (date <= checkinDate) return true;
      const minStay = minNightsByISO.get(toISO(checkinDate)) ?? 1;
      if (date < addDays(checkinDate, minStay)) return true;
    }
    return noDepartureSet.has(iso);
  }, [phase, fullyBlockedSet, noArrivalSet, noDepartureSet, minNightsByISO, checkinDate]);

  const smartDefaultMonth = useMemo(() => {
    if (checkinDate) return checkinDate;
    if (calendarDays.length === 0) return todayPlus(14);
    for (let i = 0; i < 30; i++) {
      const target = todayPlus(i);
      const iso = toISO(target);
      const day = calendarDays.find((d) => d.date === iso);
      if (day?.isAvailable && !day.closedOnArrival) return target;
    }
    return todayPlus(14);
  }, [calendarDays, checkinDate]);

  const checkinISO = toISO(checkinDate);
  const checkoutISO = toISO(checkoutDate);

  useEffect(() => {
    if (!checkinDate || !checkoutDate || sameDay(checkinDate, checkoutDate)) {
      setResponse(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      property: propertySlug,
      checkin: checkinISO,
      checkout: checkoutISO,
      guests: String(guests),
      payment: paymentMethod,
    });
    if (couponApplied) params.set("coupon", couponApplied);

    const ctrl = new AbortController();
    fetch(`/api/price?${params.toString()}`, { signal: ctrl.signal })
      .then(async (r) => {
        const data = (await r.json()) as PriceResponse;
        setResponse(data);
      })
      .catch(() => setResponse(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [propertySlug, checkinISO, checkoutISO, guests, paymentMethod, couponApplied, checkinDate, checkoutDate]);

  function applyCoupon() {
    setCouponApplied(couponInput.trim().toUpperCase());
  }

  function handleContinue() {
    if (!checkinDate || !checkoutDate || !response || response.ok !== true) return;
    const params = new URLSearchParams({
      propertyId: propertySlug,
      checkin: toISO(checkinDate),
      checkout: toISO(checkoutDate),
      guests: String(guests),
      payment: paymentMethod,
    });
    if (couponApplied) params.set("coupon", couponApplied);
    router.push(`/reservar?${params.toString()}`);
  }

  const okQuote = response && response.ok === true ? response : null;
  const failure = response && response.ok === false ? response.failure : null;
  const canContinue = Boolean(okQuote && !loading);

  return (
    <div id="reservar" className="rounded-sm border border-charcoal/10 bg-cream p-6 shadow-xl shadow-charcoal/5 sm:p-8">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          {phase === "checkin" ? "Selecione o check-in" : "Selecione o check-out"}
        </span>
        {okQuote && (
          <span className="font-serif text-2xl text-charcoal">
            {formatBRLPrecise(okQuote.averageNightly)}
            <span className="ml-1 font-sans text-xs uppercase tracking-widest text-charcoal/60">/ noite</span>
          </span>
        )}
      </div>

      <div className="rdp-wrapper mb-2">
        <DayPicker
          mode="range"
          numberOfMonths={1}
          locale={ptBR}
          defaultMonth={smartDefaultMonth}
          selected={range}
          onSelect={() => {}}
          onDayClick={handleDayClick}
          disabled={isDateDisabledVisual}
          modifiers={{
            noArrival: (d: Date) => noArrivalSet.has(toISO(d)) && !noDepartureSet.has(toISO(d)),
            checkoutOnly: (d: Date) => fullyBlockedSet.has(toISO(d)) && !noDepartureSet.has(toISO(d)) && !noArrivalSet.has(toISO(d)),
          }}
          modifiersClassNames={{
            noArrival: "rdp-no-arrival",
            checkoutOnly: "rdp-checkout-only",
          }}
          weekStartsOn={0}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-charcoal/5 pt-3 font-sans text-[0.6rem] uppercase tracking-[0.15em] text-charcoal/50">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-copper/50" />
          Só check-out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-charcoal/15" />
          Indisponível
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-charcoal/10 py-4 text-sm">
        <div>
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Check-in</span>
          <span className="font-serif text-lg text-charcoal">
            {checkinDate ? checkinDate.toLocaleDateString("pt-BR") : "—"}
          </span>
        </div>
        <div>
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Check-out</span>
          <span className="font-serif text-lg text-charcoal">
            {checkoutDate ? checkoutDate.toLocaleDateString("pt-BR") : "—"}
          </span>
        </div>
        <label className="col-span-2 mt-2 block">
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Hóspedes</span>
          <select
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="mt-1 w-full bg-transparent font-serif text-lg text-charcoal outline-none"
          >
            {Array.from({ length: maxCapacity }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "hóspede" : "hóspedes"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setPaymentMethod("card")}
          className={`flex-1 border px-3 py-2 font-sans text-xs uppercase tracking-widest transition-all ${paymentMethod === "card" ? "border-charcoal bg-charcoal text-cream" : "border-charcoal/20 text-charcoal hover:border-charcoal/40"}`}
        >
          Cartão
        </button>
        <button
          type="button"
          onClick={() => setPaymentMethod("pix")}
          className={`flex-1 border px-3 py-2 font-sans text-xs uppercase tracking-widest transition-all ${paymentMethod === "pix" ? "border-serra bg-serra text-cream" : "border-charcoal/20 text-charcoal hover:border-charcoal/40"}`}
        >
          Pix <span className="ml-1 text-copper">−3%</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowCoupon((v) => !v)}
        className="mt-4 flex w-full items-center justify-between border-b border-charcoal/10 pb-2 font-sans text-xs uppercase tracking-[0.2em] text-charcoal/70 hover:text-charcoal"
      >
        <span className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5" /> Tem um cupom?
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${showCoupon ? "rotate-180" : ""}`} />
      </button>
      {showCoupon && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            placeholder="Insira o código"
            className="flex-1 border border-charcoal/20 bg-transparent px-3 py-2 font-sans text-sm uppercase tracking-wider text-charcoal placeholder:text-charcoal/30 focus:border-copper focus:outline-none"
          />
          <button
            type="button"
            onClick={applyCoupon}
            className="border border-charcoal bg-charcoal px-4 py-2 font-sans text-xs uppercase tracking-widest text-cream hover:bg-serra"
          >
            Aplicar
          </button>
        </div>
      )}
      {okQuote?.couponError && (
        <p className="mt-2 font-sans text-xs text-red-600">{okQuote.couponError}</p>
      )}
      {okQuote?.coupon && (
        <p className="mt-2 font-sans text-xs text-serra">
          ✓ {okQuote.coupon.code} aplicado — {okQuote.coupon.description}
        </p>
      )}

      {okQuote && okQuote.nights > 0 && (
        <div className="mt-6 space-y-2 border-t border-charcoal/10 pt-4 font-sans text-sm">
          <div className="flex justify-between text-charcoal/80">
            <span>{formatBRLPrecise(okQuote.averageNightly)} × {okQuote.nights} {okQuote.nights === 1 ? "noite" : "noites"}</span>
            <span>{formatBRLPrecise(okQuote.baseTotal)}</span>
          </div>
          {okQuote.cleaningFee > 0 && (
            <div className="flex justify-between text-charcoal/80">
              <span>Taxa de limpeza</span>
              <span>{formatBRLPrecise(okQuote.cleaningFee)}</span>
            </div>
          )}
          {okQuote.extraGuestFee > 0 && (
            <div className="flex justify-between text-charcoal/80">
              <span>Hóspedes adicionais</span>
              <span>{formatBRLPrecise(okQuote.extraGuestFee)}</span>
            </div>
          )}
          {okQuote.coupon && (
            <div className="flex justify-between text-serra">
              <span>Cupom {okQuote.coupon.code}</span>
              <span>− {formatBRLPrecise(okQuote.coupon.discount)}</span>
            </div>
          )}
          {okQuote.pixDiscount > 0 && (
            <div className="flex justify-between text-serra">
              <span>Desconto Pix (3%)</span>
              <span>− {formatBRLPrecise(okQuote.pixDiscount)}</span>
            </div>
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-charcoal/10 pt-3 font-serif">
            <span className="text-base uppercase tracking-widest text-charcoal/70">Total</span>
            <span className="text-3xl text-charcoal">{formatBRLPrecise(okQuote.finalTotal)}</span>
          </div>
        </div>
      )}

      {loading && <p className="mt-4 font-sans text-xs text-charcoal/50">Calculando preço…</p>}
      {failure && (
        <p className="mt-4 font-sans text-xs text-copper">
          {failure.message}
        </p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        className="mt-6 flex w-full items-center justify-center gap-2 bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continuar para reserva <ArrowRight className="h-4 w-4" />
      </button>

      <a
        href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Gostaria de reservar o ${propertySlug} de ${checkinDate?.toLocaleDateString("pt-BR") ?? "?"} a ${checkoutDate?.toLocaleDateString("pt-BR") ?? "?"} para ${guests} hóspedes.`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal/20 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
      >
        <MessageCircle className="h-4 w-4" /> Falar com o concierge
      </a>
    </div>
  );
}
