"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Tag, Check } from "lucide-react";
import SmartImage from "@/components/ui/SmartImage";
import Kicker from "@/components/ui/Kicker";
import GuestForm from "@/components/booking/GuestForm";
import { SITE, whatsappLink, validateCoupon, type CouponValidation } from "@/config/site";
import { formatBRLPrecise } from "@/lib/cn";
import { trackInitiateCheckout } from "@/lib/tracking";

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

type PackageInfo = {
  slug: string;
  name: string;
  stayTotal: number;
  extras: { label: string; amount: number }[];
  total: number;
  aLaCarte: number;
};

type ServiceExtraOption = {
  id: string;
  label: string;
  amount: number;
  restriction?: string;
  preselected: boolean;
};

type Props = {
  property: PropertySummary;
  checkin: string;
  checkout: string;
  guests: number;
  initialPaymentMethod: "card" | "pix";
  initialCouponCode?: string;
  quote: Quote;
  packageInfo?: PackageInfo | null;
  packageChoices?: string;
  packageExtrasActive?: string;
  serviceExtras?: ServiceExtraOption[];
};

export default function BookingPageClient({
  property,
  checkin,
  checkout,
  guests,
  initialPaymentMethod,
  initialCouponCode,
  quote,
  packageInfo,
  packageChoices,
  packageExtrasActive,
  serviceExtras = [],
}: Props) {
  const [paymentMethod, setPaymentMethod] = useState<"card" | "pix">(initialPaymentMethod);

  const [couponExpanded, setCouponExpanded] = useState(Boolean(initialCouponCode));
  const [couponInput, setCouponInput] = useState(initialCouponCode ?? "");
  const [appliedCoupon, setAppliedCoupon] = useState(() => {
    if (!initialCouponCode || !quote) return "";
    const r = validateCoupon(initialCouponCode, { nights: quote.nights, subtotal: quote.totalPrice });
    return r.valid ? initialCouponCode : "";
  });
  const [couponResult, setCouponResult] = useState<CouponValidation | null>(() => {
    if (!initialCouponCode || !quote) return null;
    return validateCoupon(initialCouponCode, { nights: quote.nights, subtotal: quote.totalPrice });
  });

  useEffect(() => {
    if (quote) trackInitiateCheckout({ value: quote.totalPrice, currency: "BRL" });
  }, []);

  useEffect(() => {
    if (!appliedCoupon || !quote) return;
    const result = validateCoupon(appliedCoupon, {
      nights: quote.nights,
      subtotal: quote.totalPrice,
      paymentMethod,
    });
    setCouponResult(result);
    if (!result.valid) setAppliedCoupon("");
  }, [paymentMethod]);

  function applyCouponCode() {
    const code = couponInput.trim().toUpperCase();
    if (!code || !quote) return;
    const result = validateCoupon(code, {
      nights: quote.nights,
      subtotal: quote.totalPrice,
      paymentMethod,
    });
    setCouponResult(result);
    setAppliedCoupon(result.valid ? code : "");
  }

  // Extras de serviço (massagem, cestas): marcáveis; itens vindos do link já pré-marcados.
  // Adicionais de serviço — somados após cupom e Pix (não recebem desconto).
  const [activeServices, setActiveServices] = useState<string[]>(() =>
    serviceExtras.filter((e) => e.preselected).map((e) => e.id),
  );
  function toggleService(id: string) {
    setActiveServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }
  const servicesTotal = serviceExtras
    .filter((e) => activeServices.includes(e.id))
    .reduce((s, e) => s + e.amount, 0);

  const couponDiscount = couponResult?.valid ? couponResult.discountAmount : 0;
  const afterCoupon = (quote?.totalPrice ?? 0) - couponDiscount;
  const pixDiscount = paymentMethod === "pix" ? afterCoupon * 0.03 : 0;
  const runningTotal = afterCoupon - pixDiscount + servicesTotal;

  return (
    <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
      <section>
        <GuestForm
          propertySlug={property.slug}
          checkin={checkin}
          checkout={checkout}
          guests={guests}
          nights={quote?.nights}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          couponCode={packageInfo ? undefined : appliedCoupon || undefined}
          packageSlug={packageInfo?.slug}
          packageChoices={packageInfo ? packageChoices : undefined}
          packageExtrasActive={packageInfo ? packageExtrasActive : undefined}
          serviceExtras={activeServices}
        />

        {/* Adicione à sua experiência — extras de serviço marcáveis */}
        {serviceExtras.length > 0 && (
          <div className="mt-10 border-t border-charcoal/10 pt-8">
            <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
              Adicione à sua experiência
            </span>
            <p className="mt-2 font-sans text-sm text-charcoal/60">
              Opcionais cobrados junto com a reserva. Nosso concierge organiza tudo.
            </p>
            <div className="mt-5 space-y-3">
              {serviceExtras.map((e) => {
                const active = activeServices.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleService(e.id)}
                    className={`flex w-full items-start gap-3 border p-4 text-left transition-all ${
                      active ? "border-serra bg-serra/5" : "border-charcoal/15 hover:border-charcoal/30"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center border ${
                        active ? "border-serra bg-serra text-cream" : "border-charcoal/30"
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-serif text-base text-charcoal">{e.label}</span>
                        <span className="flex-shrink-0 font-sans text-sm text-charcoal/80">
                          {formatBRLPrecise(e.amount)}
                        </span>
                      </span>
                      {e.restriction && (
                        <span className="mt-1 block font-sans text-xs text-copper">{e.restriction}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
            {packageInfo && (
              <p className="mt-1 font-sans text-xs uppercase tracking-[0.2em] text-copper">
                Pacote {packageInfo.name}
              </p>
            )}

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

            {/* Coupon — pacotes não combinam com cupom */}
            {!packageInfo && (
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
            )}

            {/* Totals */}
            {quote ? (
              <div className="mt-5 space-y-2 font-sans text-sm">
                {packageInfo ? (
                  <>
                    <div className="flex justify-between text-charcoal/80">
                      <span>Estadia ({quote.nights} noites) — pacote</span>
                      <span>{formatBRLPrecise(packageInfo.stayTotal)}</span>
                    </div>
                    {packageInfo.extras.map((e) => (
                      <div key={e.label} className="flex justify-between gap-4 text-charcoal/80">
                        <span>{e.label}</span>
                        <span className="flex-shrink-0">{formatBRLPrecise(e.amount)}</span>
                      </div>
                    ))}
                    {packageInfo.aLaCarte > packageInfo.total && (
                      <div className="flex justify-between text-charcoal/50">
                        <span>Valor à la carte</span>
                        <span className="line-through">{formatBRLPrecise(packageInfo.aLaCarte)}</span>
                      </div>
                    )}
                  </>
                ) : (
                <div className="flex justify-between text-charcoal/80">
                  <span>Subtotal</span>
                  <span>{formatBRLPrecise(quote.totalPrice)}</span>
                </div>
                )}
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
                {serviceExtras
                  .filter((e) => activeServices.includes(e.id))
                  .map((e) => (
                    <div key={e.id} className="flex justify-between gap-4 text-charcoal/80">
                      <span className="min-w-0">{e.label}</span>
                      <span className="flex-shrink-0">{formatBRLPrecise(e.amount)}</span>
                    </div>
                  ))}
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
