"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Tag } from "lucide-react";
import SmartImage from "@/components/ui/SmartImage";
import Kicker from "@/components/ui/Kicker";
import GuestForm from "@/components/booking/GuestForm";
import { SITE, whatsappLink, validateCoupon, type CouponValidation } from "@/config/site";
import { formatBRLPrecise } from "@/lib/cn";

type Quote = {
  totalPrice: number;
  nights: number;
} | null;

type PropertySummary = {
  slug: string;
  name: string;
  badge: string;
  heroImage: string;
};

type Props = {
  property: PropertySummary;
  checkin: string;
  checkout: string;
  guests: number;
  initialPaymentMethod: "card" | "pix";
  initialCouponCode?: string;
  quote: Quote;
};

export default function BookingPageClient({
  property,
  checkin,
  checkout,
  guests,
  initialPaymentMethod,
  initialCouponCode,
  quote,
}: Props) {
  const [paymentMethod, setPaymentMethod] = useState<"card" | "pix">(initialPaymentMethod);

  const [couponExpanded, setCouponExpanded] = useState(Boolean(initialCouponCode));
  const [couponInput, setCouponInput] = useState(initialCouponCode ?? "");
  const [appliedCoupon, setAppliedCoupon] = useState(() => {
    if (!initialCouponCode || !quote) return "";
    const r = validateCoupon(initialCouponCode, quote.nights, quote.totalPrice);
    return r.valid ? initialCouponCode : "";
  });
  const [couponResult, setCouponResult] = useState<CouponValidation | null>(() => {
    if (!initialCouponCode || !quote) return null;
    return validateCoupon(initialCouponCode, quote.nights, quote.totalPrice);
  });

  function applyCouponCode() {
    const code = couponInput.trim().toUpperCase();
    if (!code || !quote) return;
    const result = validateCoupon(code, quote.nights, quote.totalPrice);
    setCouponResult(result);
    setAppliedCoupon(result.valid ? code : "");
  }

  const couponDiscount = couponResult?.valid ? couponResult.discountAmount : 0;
  const afterCoupon = (quote?.totalPrice ?? 0) - couponDiscount;
  const pixDiscount = paymentMethod === "pix" ? afterCoupon * 0.03 : 0;
  const runningTotal = afterCoupon - pixDiscount;

  return (
    <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
      <section>
        <GuestForm
          propertySlug={property.slug}
          checkin={checkin}
          checkout={checkout}
          guests={guests}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          couponCode={appliedCoupon || undefined}
        />
      </section>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="border border-charcoal/10 bg-white">
          <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
            <SmartImage
              src={property.heroImage}
              alt={property.name}
              sizes="(max-width: 1024px) 100vw, 40vw"
            />
          </div>
          <div className="p-6">
            <Kicker className="mb-2">{property.badge}</Kicker>
            <h2 className="font-serif text-2xl text-charcoal">{property.name}</h2>

            <ul className="mt-5 space-y-3 border-y border-charcoal/10 py-5 font-sans text-sm">
              <li className="flex justify-between">
                <span className="text-charcoal/60">Check-in</span>
                <span className="text-charcoal">
                  {new Date(checkin + "T12:00:00").toLocaleDateString("pt-BR")}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-charcoal/60">Check-out</span>
                <span className="text-charcoal">
                  {new Date(checkout + "T12:00:00").toLocaleDateString("pt-BR")}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-charcoal/60">Hóspedes</span>
                <span className="text-charcoal">{guests}</span>
              </li>
              {quote && (
                <li className="flex justify-between">
                  <span className="text-charcoal/60">Noites</span>
                  <span className="text-charcoal">{quote.nights}</span>
                </li>
              )}
            </ul>

            {/* Coupon */}
            <div className="border-b border-charcoal/10 py-4">
              <button
                type="button"
                onClick={() => setCouponExpanded((v) => !v)}
                className="flex w-full items-center justify-between font-sans text-xs uppercase tracking-[0.2em] text-charcoal/60 hover:text-charcoal"
              >
                <span className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5" />
                  Tem um cupom?
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${couponExpanded ? "rotate-180" : ""}`} />
              </button>
              {couponExpanded && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyCouponCode()}
                      placeholder="Código do cupom"
                      className="flex-1 border border-charcoal/20 bg-cream px-3 py-2 font-sans text-xs uppercase tracking-wider text-charcoal placeholder:normal-case placeholder:tracking-normal placeholder:text-charcoal/30 focus:border-copper focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={applyCouponCode}
                      className="border border-charcoal bg-charcoal px-3 py-2 font-sans text-xs uppercase tracking-widest text-cream hover:bg-serra"
                    >
                      Aplicar
                    </button>
                  </div>
                  {couponResult && couponResult.valid && (
                    <p className="font-sans text-xs text-serra">
                      ✓ {appliedCoupon} — {couponResult.coupon.description}
                    </p>
                  )}
                  {couponResult && !couponResult.valid && (
                    <p className="font-sans text-xs text-red-600">{couponResult.reason}</p>
                  )}
                </div>
              )}
            </div>

            {/* Totals */}
            {quote ? (
              <div className="mt-5 space-y-2 font-sans text-sm">
                <div className="flex justify-between text-charcoal/80">
                  <span>Subtotal</span>
                  <span>{formatBRLPrecise(quote.totalPrice)}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-serra">
                    <span>Cupom {appliedCoupon}</span>
                    <span>− {formatBRLPrecise(couponDiscount)}</span>
                  </div>
                )}
                {pixDiscount > 0 && (
                  <div className="flex justify-between text-serra">
                    <span>Desconto Pix (3%)</span>
                    <span>− {formatBRLPrecise(pixDiscount)}</span>
                  </div>
                )}
                <div className="mt-3 flex items-baseline justify-between border-t border-charcoal/10 pt-3 font-serif">
                  <span className="text-base uppercase tracking-widest text-charcoal/70">Total</span>
                  <span className="text-3xl text-charcoal">{formatBRLPrecise(runningTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-5 border border-charcoal/10 p-4 font-sans text-xs text-charcoal/60">
                <p>Não foi possível calcular o preço para essas datas.</p>
                <a
                  href={whatsappLink("Olá! Preciso de ajuda para reservar.")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-sans text-xs text-copper underline"
                >
                  Fale com o concierge
                </a>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-center font-sans text-xs text-charcoal/50">
          Dúvidas?{" "}
          <a
            href={whatsappLink("Olá! Estou na etapa de preencher meus dados para reservar.")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-copper underline"
          >
            {SITE.whatsappDisplay}
          </a>
        </p>
      </aside>
    </div>
  );
}
