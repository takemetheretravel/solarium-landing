"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { ChevronDown, Tag, MessageCircle, ArrowRight } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";

type CalendarDay = { date: string; isAvailable: boolean; price: number; minimumStay: number };

type Quote = {
  nights: number;
  averageNightly: number;
  cleaningFee: number;
  discount: number;
  baseTotal: number;
  hostawayTotal: number;
  coupon: { code: string; description: string; discount: number } | null;
  couponError: string | null;
  paymentMethod: string;
  pixDiscount: number;
  finalTotal: number;
  currency: string;
};

type Props = {
  propertySlug: string;
  initialCheckin?: string;
  initialCheckout?: string;
  initialGuests?: number;
  maxCapacity: number;
};

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

export default function BookingForm({
  propertySlug,
  initialCheckin,
  initialCheckout,
  initialGuests = 2,
  maxCapacity,
}: Props) {
  const router = useRouter();
  const [range, setRange] = useState<{ from?: Date; to?: Date }>({
    from: initialCheckin ? fromISO(initialCheckin) : todayPlus(14),
    to: initialCheckout ? fromISO(initialCheckout) : todayPlus(16),
  });
  const [guests, setGuests] = useState(initialGuests);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "pix">("card");
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState("");
  const [showCoupon, setShowCoupon] = useState(false);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const start = toISO(todayPlus(0));
    const end = toISO(todayPlus(365));
    fetch(`/api/calendar?property=${propertySlug}&start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.days) setCalendarDays(data.days);
      })
      .catch(() => {});
  }, [propertySlug]);

  const disabledDays = useMemo(() => {
    const blocked = calendarDays
      .filter((d) => !d.isAvailable)
      .map((d) => fromISO(d.date))
      .filter((d): d is Date => Boolean(d));
    return [{ before: todayPlus(0) }, ...blocked];
  }, [calendarDays]);

  const checkinISO = toISO(range.from);
  const checkoutISO = toISO(range.to);

  useEffect(() => {
    if (!range.from || !range.to) {
      setQuote(null);
      return;
    }
    const ci = toISO(range.from);
    const co = toISO(range.to);
    if (ci === co) {
      setQuote(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      property: propertySlug,
      checkin: ci,
      checkout: co,
      guests: String(guests),
      payment: paymentMethod,
    });
    if (couponApplied) params.set("coupon", couponApplied);

    const ctrl = new AbortController();
    fetch(`/api/price?${params.toString()}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          setQuote(null);
          return;
        }
        const data = (await r.json()) as Quote;
        setQuote(data);
      })
      .catch(() => setQuote(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [propertySlug, checkinISO, checkoutISO, guests, paymentMethod, couponApplied, range.from, range.to]);

  function applyCoupon() {
    setCouponApplied(couponInput.trim().toUpperCase());
  }

  function handleReserve() {
    if (!range.from || !range.to) return;
    const params = new URLSearchParams({
      property: propertySlug,
      checkin: toISO(range.from),
      checkout: toISO(range.to),
      guests: String(guests),
      payment: paymentMethod,
    });
    if (couponApplied) params.set("coupon", couponApplied);
    router.push(`/checkout?${params.toString()}`);
  }

  const canReserve = Boolean(range.from && range.to && quote && !loading);

  return (
    <div className="rounded-sm border border-charcoal/10 bg-cream p-6 shadow-xl shadow-charcoal/5 sm:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Reserve diretamente
        </span>
        {quote && (
          <span className="font-serif text-2xl text-charcoal">
            {formatBRLPrecise(quote.averageNightly)}
            <span className="ml-1 font-sans text-xs uppercase tracking-widest text-charcoal/60">/ noite</span>
          </span>
        )}
      </div>

      <div className="rdp-wrapper mb-6">
        <DayPicker
          mode="range"
          numberOfMonths={1}
          locale={undefined}
          selected={range as { from: Date | undefined; to: Date | undefined }}
          onSelect={(r) => setRange({ from: r?.from, to: r?.to })}
          disabled={disabledDays}
          weekStartsOn={0}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-y border-charcoal/10 py-4 text-sm">
        <div>
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Check-in</span>
          <span className="font-serif text-lg text-charcoal">
            {range.from ? range.from.toLocaleDateString("pt-BR") : "—"}
          </span>
        </div>
        <div>
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Check-out</span>
          <span className="font-serif text-lg text-charcoal">
            {range.to ? range.to.toLocaleDateString("pt-BR") : "—"}
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
      {quote?.couponError && (
        <p className="mt-2 font-sans text-xs text-red-600">{quote.couponError}</p>
      )}
      {quote?.coupon && (
        <p className="mt-2 font-sans text-xs text-serra">
          ✓ {quote.coupon.code} aplicado — {quote.coupon.description}
        </p>
      )}

      {quote && quote.nights > 0 && (
        <div className="mt-6 space-y-2 border-t border-charcoal/10 pt-4 font-sans text-sm">
          <div className="flex justify-between text-charcoal/80">
            <span>{formatBRLPrecise(quote.averageNightly)} × {quote.nights} {quote.nights === 1 ? "noite" : "noites"}</span>
            <span>{formatBRLPrecise(quote.baseTotal)}</span>
          </div>
          {quote.discount > 0 && (
            <div className="flex justify-between text-serra">
              <span>Desconto de estadia</span>
              <span>− {formatBRLPrecise(quote.discount)}</span>
            </div>
          )}
          {quote.cleaningFee > 0 && (
            <div className="flex justify-between text-charcoal/80">
              <span>Taxa de limpeza</span>
              <span>{formatBRLPrecise(quote.cleaningFee)}</span>
            </div>
          )}
          {quote.coupon && (
            <div className="flex justify-between text-serra">
              <span>Cupom {quote.coupon.code}</span>
              <span>− {formatBRLPrecise(quote.coupon.discount)}</span>
            </div>
          )}
          {quote.pixDiscount > 0 && (
            <div className="flex justify-between text-serra">
              <span>Desconto Pix (3%)</span>
              <span>− {formatBRLPrecise(quote.pixDiscount)}</span>
            </div>
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-charcoal/10 pt-3 font-serif">
            <span className="text-base uppercase tracking-widest text-charcoal/70">Total</span>
            <span className="text-3xl text-charcoal">{formatBRLPrecise(quote.finalTotal)}</span>
          </div>
        </div>
      )}

      {loading && <p className="mt-4 font-sans text-xs text-charcoal/50">Calculando preço…</p>}
      {!quote && !loading && range.from && range.to && (
        <p className="mt-4 font-sans text-xs text-charcoal/50">
          Preço indisponível para essas datas. Tente outras ou fale com o concierge.
        </p>
      )}

      <button
        type="button"
        onClick={handleReserve}
        disabled={!canReserve}
        className="mt-6 flex w-full items-center justify-center gap-2 bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reservar agora <ArrowRight className="h-4 w-4" />
      </button>

      <a
        href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Gostaria de reservar o ${propertySlug} de ${range.from?.toLocaleDateString("pt-BR") ?? "?"} a ${range.to?.toLocaleDateString("pt-BR") ?? "?"} para ${guests} hóspedes.`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal/20 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
      >
        <MessageCircle className="h-4 w-4" /> Falar com o concierge
      </a>
    </div>
  );
}
