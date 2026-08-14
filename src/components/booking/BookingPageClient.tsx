"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Tag } from "lucide-react";
import SmartImage from "@/components/ui/SmartImage";
import Kicker from "@/components/ui/Kicker";
import GuestForm from "@/components/booking/GuestForm";
import { SITE, whatsappLink, validateCoupon, type CouponValidation } from "@/config/site";
import { MAX_QTY_PER_EXTRA } from "@/config/service-extras";
import { OP_EXTRA_TYPES } from "@/config/operational-extras";
import { formatBRLPrecise, formatExtraPrice } from "@/lib/cn";
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
  unitPrice: number;
  restriction?: string;
  qty: number; // quantidade inicial pré-marcada via link (0 = não marcado)
};

type OpExtraOption = {
  type: string;
  label: string;
  available: boolean;
  price: number;
  anchor: number | null; // valor fds riscado (corte de preço no domingo); null = sem âncora
  blockedNight: string;
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
  pacoteId?: string;
  removidos?: string[];
  selecaoExtrasPacote?: Record<string, number>;
  packageChoices?: string;
  packageExtrasActive?: string;
  serviceExtras?: ServiceExtraOption[];
  opExtrasPreselected?: string[];
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
  pacoteId,
  removidos,
  selecaoExtrasPacote,
  packageChoices,
  packageExtrasActive,
  serviceExtras = [],
  opExtrasPreselected = [],
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

  // Extras de serviço (massagem, cestas): marcáveis por QUANTIDADE; link pré-preenche.
  // Quantidade é independente das noites. Somados após cupom e Pix (não recebem desconto).
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const e of serviceExtras) if (e.qty > 0) init[e.id] = e.qty;
    return init;
  });
  function setQty(id: string, n: number) {
    const clamped = Math.min(Math.max(0, Math.floor(n)), MAX_QTY_PER_EXTRA);
    setQuantities((prev) => ({ ...prev, [id]: clamped }));
  }
  const servicesTotal = serviceExtras.reduce(
    (s, e) => s + e.unitPrice * (quantities[e.id] || 0),
    0,
  );
  const activeServiceItems = serviceExtras
    .filter((e) => (quantities[e.id] || 0) > 0)
    .map((e) => ({ id: e.id, qty: quantities[e.id] }));

  // Extras operacionais (early check-in / late checkout): disponibilidade e preço
  // dependem da noite adjacente — consultados na montagem via /api/extras/check.
  const [opOptions, setOpOptions] = useState<OpExtraOption[]>([]);
  const [activeOps, setActiveOps] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/extras/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: property.slug, checkin, checkout, types: OP_EXTRA_TYPES }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data?.results)) return;
        const results = data.results as OpExtraOption[];
        setOpOptions(results);
        // Pré-marcar os que vieram no link — só se realmente disponíveis.
        const pre = results
          .filter((o) => o.available && opExtrasPreselected.includes(o.type))
          .map((o) => o.type);
        if (pre.length) setActiveOps(pre);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  function toggleOp(type: string) {
    setActiveOps((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }
  const opActiveTotal = opOptions
    .filter((o) => o.available && activeOps.includes(o.type))
    .reduce((s, o) => s + o.price, 0);
  const activeOpItems = opOptions
    .filter((o) => o.available && activeOps.includes(o.type))
    .map((o) => o.type);

  const couponDiscount = couponResult?.valid ? couponResult.discountAmount : 0;
  const afterCoupon = (quote?.totalPrice ?? 0) - couponDiscount;
  const pixDiscount = paymentMethod === "pix" ? afterCoupon * 0.03 : 0;
  const runningTotal = afterCoupon - pixDiscount + servicesTotal + opActiveTotal;

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
          packageSlug={pacoteId ? undefined : packageInfo?.slug}
          pacoteId={pacoteId}
          removidos={removidos}
          selecaoExtras={selecaoExtrasPacote}
          packageChoices={packageInfo ? packageChoices : undefined}
          packageExtrasActive={packageInfo ? packageExtrasActive : undefined}
          serviceExtras={activeServiceItems}
          opExtras={activeOpItems}
        />

        {/* Adicione à sua experiência — serviços (stepper) + operacionais (toggle) */}
        {(serviceExtras.length > 0 || opOptions.length > 0) && (
          <div className="mt-10 border-t border-charcoal/10 pt-8">
            <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
              Adicione à sua experiência
            </span>
            <p className="mt-2 font-sans text-sm text-charcoal/60">
              Opcionais cobrados junto com a reserva. Nosso concierge organiza tudo.
            </p>

            {serviceExtras.length > 0 && (
              <div className="mt-5 space-y-3">
                {serviceExtras.map((e) => {
                  const qty = quantities[e.id] || 0;
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-3 py-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-sans text-sm text-charcoal">{e.label}</p>
                        <p className="font-sans text-xs text-charcoal/45">
                          {formatExtraPrice(e.unitPrice)} cada
                        </p>
                        {qty > 0 && e.restriction && (
                          <p className="mt-0.5 font-sans text-xs text-copper">{e.restriction}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {qty > 0 && (
                          <span className="font-serif text-sm text-charcoal/70">
                            {formatExtraPrice(e.unitPrice * qty)}
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQty(e.id, qty - 1)}
                            disabled={qty === 0}
                            aria-label={`Remover ${e.label}`}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-charcoal/20 text-charcoal/70 transition-colors hover:border-charcoal disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-5 text-center font-sans text-sm tabular-nums">{qty}</span>
                          <button
                            type="button"
                            onClick={() => setQty(e.id, qty + 1)}
                            disabled={qty >= MAX_QTY_PER_EXTRA}
                            aria-label={`Adicionar ${e.label}`}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-charcoal/20 text-charcoal/70 transition-colors hover:border-charcoal disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {opOptions.length > 0 && (
              <div
                className={`space-y-3 ${serviceExtras.length > 0 ? "mt-3 border-t border-charcoal/10 pt-3" : "mt-5"}`}
              >
                {opOptions.map((o) => {
                  const active = o.available && activeOps.includes(o.type);
                  return (
                    <div key={o.type} className="flex items-center justify-between gap-3 py-1">
                      <div className="min-w-0 flex-1">
                        <p className={`font-sans text-sm ${o.available ? "text-charcoal" : "text-charcoal/40"}`}>
                          {o.label}
                        </p>
                        {o.available ? (
                          <p className="font-sans text-xs text-charcoal/45">
                            {o.anchor != null && (
                              <span className="text-charcoal/35 line-through">{formatExtraPrice(o.anchor)} </span>
                            )}
                            {formatExtraPrice(o.price)}
                          </p>
                        ) : (
                          <p className="font-sans text-xs text-charcoal/40">indisponível para estas datas</p>
                        )}
                      </div>
                      {o.available && (
                        <div className="flex items-center gap-3">
                          {active && (
                            <span className="font-serif text-sm text-charcoal/70">
                              {formatExtraPrice(o.price)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleOp(o.type)}
                            aria-pressed={active}
                            className={`rounded-full border px-4 py-1 font-sans text-xs uppercase tracking-[0.15em] transition-colors ${
                              active
                                ? "border-serra bg-serra text-cream"
                                : "border-charcoal/20 text-charcoal/70 hover:border-charcoal"
                            }`}
                          >
                            {active ? "Remover" : "Adicionar"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
                  .filter((e) => (quantities[e.id] || 0) > 0)
                  .map((e) => {
                    const qty = quantities[e.id];
                    return (
                      <div key={e.id} className="flex justify-between gap-4 text-charcoal/80">
                        <span className="min-w-0">
                          {e.label}
                          {qty > 1 ? ` ×${qty}` : ""}
                        </span>
                        <span className="flex-shrink-0">{formatBRLPrecise(e.unitPrice * qty)}</span>
                      </div>
                    );
                  })}
                {opOptions
                  .filter((o) => o.available && activeOps.includes(o.type))
                  .map((o) => (
                    <div key={o.type} className="flex justify-between gap-4 text-charcoal/80">
                      <span className="min-w-0">{o.label}</span>
                      <span className="flex-shrink-0">{formatBRLPrecise(o.price)}</span>
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
