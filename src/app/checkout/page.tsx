import Link from "next/link";
import { Metadata } from "next";
import { MessageCircle, AlertCircle, ArrowLeft } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { calculatePrice } from "@/lib/hostaway";
import { getPropertyBySlug } from "@/config/properties";
import { validateCoupon, SITE } from "@/config/site";
import { formatBRLPrecise } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Reserva — Pagamento",
  description: "Finalize sua reserva no Solarium Mantiqueira.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Search = {
  property?: string;
  checkin?: string;
  checkout?: string;
  guests?: string;
  payment?: string;
  coupon?: string;
};

export default async function CheckoutPage({ searchParams }: { searchParams: Search }) {
  const slug = searchParams.property;
  const property = slug ? getPropertyBySlug(slug) : undefined;
  const checkin = searchParams.checkin || "";
  const checkout = searchParams.checkout || "";
  const guests = Number(searchParams.guests || 2);
  const paymentMethod = (searchParams.payment as "card" | "pix") || "card";
  const couponCode = (searchParams.coupon || "").trim().toUpperCase();

  const quote =
    property && checkin && checkout
      ? await calculatePrice(property.id, checkin, checkout, guests)
      : null;

  let runningTotal = quote?.totalPrice ?? 0;
  let couponInfo: { code: string; discountAmount: number; description: string } | null = null;
  let pixDiscount = 0;

  if (couponCode && quote) {
    const v = validateCoupon(couponCode, quote.nights, quote.totalPrice);
    if (v.valid) {
      couponInfo = {
        code: v.coupon.code,
        discountAmount: v.discountAmount,
        description: v.coupon.description,
      };
      runningTotal = Math.max(0, runningTotal - v.discountAmount);
    }
  }

  if (paymentMethod === "pix" && quote) {
    pixDiscount = runningTotal * 0.03;
    runningTotal = runningTotal - pixDiscount;
  }

  const wppMessage = property && quote
    ? `Olá! Quero finalizar a reserva:\n\n• Casa: ${property.name}\n• Check-in: ${new Date(checkin).toLocaleDateString("pt-BR")}\n• Check-out: ${new Date(checkout).toLocaleDateString("pt-BR")}\n• Hóspedes: ${guests}\n• Pagamento: ${paymentMethod === "pix" ? "Pix (-3%)" : "Cartão"}${couponInfo ? `\n• Cupom: ${couponInfo.code}` : ""}\n• Total: ${formatBRLPrecise(runningTotal)}`
    : `Olá! Gostaria de finalizar uma reserva no Solarium Mantiqueira.`;

  return (
    <main className="pt-32 pb-20">
      <Container size="narrow">
        <Link
          href={property ? `/${property.slug}` : "/"}
          className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60 hover:text-copper"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>

        <Kicker className="mt-8 mb-4">Pagamento</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">Quase lá.</Heading>

        <div className="mt-8 flex items-start gap-4 border border-copper/40 bg-copper/10 p-5 font-sans text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-copper" />
          <div>
            <p className="font-medium text-charcoal">
              O pagamento online estará disponível em breve.
            </p>
            <p className="mt-1 text-charcoal/75">
              Por enquanto, finalize sua reserva direto pelo WhatsApp. Mandamos o link de pagamento e confirmamos rapidinho.
            </p>
          </div>
        </div>

        {property && quote ? (
          <Section spacing="tight">
            <div className="border border-charcoal/10 bg-cream p-8">
              <Kicker className="mb-2">Resumo da reserva</Kicker>
              <h2 className="font-serif text-3xl text-charcoal">{property.name}</h2>
              <ul className="mt-6 space-y-3 border-y border-charcoal/10 py-5 font-sans text-sm">
                <li className="flex justify-between"><span className="text-charcoal/60">Check-in</span><span className="text-charcoal">{new Date(checkin).toLocaleDateString("pt-BR")}</span></li>
                <li className="flex justify-between"><span className="text-charcoal/60">Check-out</span><span className="text-charcoal">{new Date(checkout).toLocaleDateString("pt-BR")}</span></li>
                <li className="flex justify-between"><span className="text-charcoal/60">Hóspedes</span><span className="text-charcoal">{guests}</span></li>
                <li className="flex justify-between"><span className="text-charcoal/60">Noites</span><span className="text-charcoal">{quote.nights}</span></li>
                <li className="flex justify-between"><span className="text-charcoal/60">Forma de pagamento</span><span className="text-charcoal">{paymentMethod === "pix" ? "Pix" : "Cartão"}</span></li>
              </ul>

              <div className="mt-5 space-y-2 font-sans text-sm">
                <div className="flex justify-between text-charcoal/80">
                  <span>Subtotal</span>
                  <span>{formatBRLPrecise(quote.totalPrice)}</span>
                </div>
                {couponInfo && (
                  <div className="flex justify-between text-serra">
                    <span>Cupom {couponInfo.code}</span>
                    <span>− {formatBRLPrecise(couponInfo.discountAmount)}</span>
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
            </div>
          </Section>
        ) : (
          <p className="mt-8 font-sans text-charcoal/70">
            Reserva sem detalhes carregados — fale com o concierge para combinarmos as datas.
          </p>
        )}

        <a
          href={`https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(wppMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 flex w-full items-center justify-center gap-2 bg-copper py-5 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-copper/90"
        >
          <MessageCircle className="h-4 w-4" /> Finalizar pelo WhatsApp
        </a>
        <p className="mt-3 text-center font-sans text-xs text-charcoal/50">
          {SITE.whatsappDisplay}
        </p>
      </Container>
    </main>
  );
}
