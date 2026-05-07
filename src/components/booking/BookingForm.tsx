"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Tag, MessageCircle, ArrowRight } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";

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

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoNextDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingForm({
  propertySlug,
  initialCheckin,
  initialCheckout,
  initialGuests = 2,
  maxCapacity,
}: Props) {
  const router = useRouter();

  const [checkin, setCheckin] = useState(initialCheckin || "");
  const [checkout, setCheckout] = useState(initialCheckout || "");
  const [guests, setGuests] = useState(initialGuests);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "pix">("card");
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState("");
  const [showCoupon, setShowCoupon] = useState(false);
  const [response, setResponse] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);

  const todayISO = useMemo(() => isoToday(), []);
  const maxDateISO = useMemo(() => isoPlus(540), []);
  const minCheckoutISO = useMemo(() => (checkin ? isoNextDay(checkin) : todayISO), [checkin, todayISO]);

  useEffect(() => {
    if (!checkin || !checkout || checkin >= checkout) {
      setResponse(null);
      return;
    }
    setLoading(true);
    setValidationError(null);

    const params = new URLSearchParams({
      property: propertySlug,
      checkin,
      checkout,
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
  }, [propertySlug, checkin, checkout, guests, paymentMethod, couponApplied]);

  function applyCoupon() {
    setCouponApplied(couponInput.trim().toUpperCase());
  }

  async function handleContinue() {
    if (!checkin || !checkout || !response || response.ok !== true || checkinError) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      const res = await fetch("/api/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: propertySlug, checkin, checkout, guests }),
      });
      const data = await res.json();

      if (!data.available) {
        setValidationError(data.reason || "Estas datas não estão disponíveis. Tente outras ou fale com nosso concierge.");
        setIsValidating(false);
        return;
      }

      const params = new URLSearchParams({
        propertyId: propertySlug,
        checkin,
        checkout,
        guests: String(guests),
        payment: paymentMethod,
      });
      if (couponApplied) params.set("coupon", couponApplied);
      router.push(`/reservar?${params.toString()}`);
    } catch {
      setValidationError("Erro ao verificar disponibilidade. Tente novamente ou fale com o concierge.");
      setIsValidating(false);
    }
  }

  const okQuote = response && response.ok === true ? response : null;
  const failure = response && response.ok === false ? response.failure : null;
  const canContinue = Boolean(okQuote && !loading && !checkinError);

  return (
    <div id="reservar" className="rounded-sm border border-charcoal/10 bg-cream p-6 shadow-xl shadow-charcoal/5 sm:p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Reserve diretamente
        </span>
        {okQuote && (
          <span className="font-serif text-2xl text-charcoal">
            {formatBRLPrecise(okQuote.averageNightly)}
            <span className="ml-1 font-sans text-xs uppercase tracking-widest text-charcoal/60">/ noite</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 border-y border-charcoal/10 py-4">
        <div>
          <label htmlFor="checkin" className="block cursor-pointer font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Check-in
          </label>
          <div className="relative cursor-pointer" onClick={() => { const el = document.getElementById("checkin") as any; el?.showPicker?.(); }}>
            <input
              id="checkin"
              type="date"
              value={checkin}
              min={todayISO}
              max={maxDateISO}
              onChange={(e) => {
                const val = e.target.value;
                setCheckin(val);
                setValidationError(null);
                if (checkout && val && val >= checkout) setCheckout("");
                if (val) {
                  setCheckinError(new Date(val + "T12:00:00").getDay() === 0 ? "Não realizamos check-in aos domingos." : null);
                } else {
                  setCheckinError(null);
                }
              }}
              className="mt-1 w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
          </div>
        </div>
        {checkinError && (
          <p className="col-span-2 mt-1 font-sans text-xs text-red-600">{checkinError}</p>
        )}
        <div>
          <label htmlFor="checkout" className="block cursor-pointer font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Check-out
          </label>
          <div className="relative cursor-pointer" onClick={() => { const el = document.getElementById("checkout") as any; el?.showPicker?.(); }}>
            <input
              id="checkout"
              type="date"
              value={checkout}
              min={minCheckoutISO}
              max={maxDateISO}
              disabled={!checkin}
              onChange={(e) => {
                setCheckout(e.target.value);
                setValidationError(null);
              }}
              className="mt-1 w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none focus:border-copper disabled:opacity-40"
            />
          </div>
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

      <p className="mt-3 font-sans text-[0.7rem] text-charcoal/50">
        Não tem certeza?{" "}
        <a
          href="https://wa.me/5535984075652?text=Ol%C3%A1!%20Gostaria%20de%20verificar%20disponibilidade%20no%20Solarium%20Mantiqueira."
          target="_blank"
          rel="noopener noreferrer"
          className="text-copper underline underline-offset-2 hover:text-copper/80"
        >
          Veja datas livres com nosso concierge
        </a>
      </p>

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
        <p className="mt-4 font-sans text-xs text-copper">{failure.message}</p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue || isValidating}
        className="mt-6 flex w-full items-center justify-center gap-2 bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isValidating ? "Verificando…" : "Continuar para reserva"}
        {!isValidating && <ArrowRight className="h-4 w-4" />}
      </button>

      {validationError && (
        <div className="mt-3 border border-copper/30 bg-copper/5 p-3">
          <p className="font-sans text-xs text-charcoal">{validationError}</p>
          <a
            href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Tentei reservar o ${propertySlug} de ${checkin} a ${checkout} mas as datas não estão disponíveis. Pode me ajudar?`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-sans text-xs text-copper underline"
          >
            Falar com o concierge no WhatsApp
          </a>
        </div>
      )}

      <a
        href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Gostaria de reservar o ${propertySlug} de ${checkin || "?"} a ${checkout || "?"} para ${guests} hóspedes.`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal/20 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
      >
        <MessageCircle className="h-4 w-4" /> Falar com o concierge
      </a>
    </div>
  );
}
