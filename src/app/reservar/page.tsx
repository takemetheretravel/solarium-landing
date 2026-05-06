import Link from "next/link";
import { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import BookingPageClient from "@/components/booking/BookingPageClient";
import { PROPERTIES, getPropertyBySlug } from "@/config/properties";
import { calculatePrice } from "@/lib/hostaway";
import { formatBRLPrecise } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Reserva — Seus dados",
  description: "Preencha seus dados para finalizar sua reserva no Solarium Mantiqueira.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Search = {
  propertyId?: string;
  checkin?: string;
  checkout?: string;
  guests?: string;
  payment?: string;
  coupon?: string;
};

function isComplete(s: Search): s is Required<Pick<Search, "propertyId" | "checkin" | "checkout">> & Search {
  return Boolean(s.propertyId && s.checkin && s.checkout);
}

export default async function ReservarPage({ searchParams }: { searchParams: Search }) {
  if (!isComplete(searchParams)) {
    const checkin = searchParams.checkin;
    const checkout = searchParams.checkout;
    const guests = Number(searchParams.guests || 2);

    let prices: Record<string, number | null> = {};
    if (checkin && checkout) {
      const results = await Promise.all(
        PROPERTIES.map(async (p) => {
          const q = await calculatePrice(p.id, checkin, checkout, guests);
          return { slug: p.slug, total: q?.totalPrice ?? null };
        })
      );
      results.forEach((r) => { prices[r.slug] = r.total; });
    }

    return <ChooseProperty checkin={checkin} checkout={checkout} guests={guests} prices={prices} />;
  }

  const property = getPropertyBySlug(searchParams.propertyId);
  if (!property) return <ChooseProperty />;
  const checkin = searchParams.checkin!;
  const checkout = searchParams.checkout!;
  const guests = Number(searchParams.guests || 2);
  const paymentMethod: "card" | "pix" = searchParams.payment === "pix" ? "pix" : "card";
  const couponCode = (searchParams.coupon || "").trim().toUpperCase();

  const quote = await calculatePrice(property.id, checkin, checkout, guests);
  if (!quote) console.error("[reservar] calculatePrice returned null for", property.id, checkin, checkout, guests);

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container size="wide">
        <Link
          href={`/${property.slug}`}
          className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60 hover:text-copper"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para {property.name}
        </Link>

        <div className="mt-8">
          <Kicker className="mb-4">Reserva — etapa 1 de 2</Kicker>
          <Heading level={1} className="text-4xl sm:text-5xl">
            Seus dados
          </Heading>
          <p className="mt-3 max-w-2xl font-sans text-base text-charcoal/70">
            Preencha as informações abaixo e siga para o pagamento. Levamos a sério a privacidade — seus dados são tratados conforme a{" "}
            <Link href="/privacidade" className="text-copper underline underline-offset-4">LGPD</Link>.
          </p>
        </div>

        <BookingPageClient
          property={{
            slug: property.slug,
            name: property.name,
            badge: property.badge,
            heroImage: property.heroImage,
          }}
          checkin={checkin}
          checkout={checkout}
          guests={guests}
          initialPaymentMethod={paymentMethod}
          initialCouponCode={couponCode || undefined}
          quote={quote ? { totalPrice: quote.totalPrice, nights: quote.nights } : null}
        />
      </Container>
    </main>
  );
}

function ChooseProperty({
  checkin,
  checkout,
  guests,
  prices,
}: {
  checkin?: string;
  checkout?: string;
  guests?: number;
  prices?: Record<string, number | null>;
}) {
  const hasDates = Boolean(checkin && checkout);

  function fmtDate(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container>
        <Kicker className="mb-4">Reserva</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">
          Escolha a casa para reservar.
        </Heading>
        {hasDates ? (
          <p className="mt-4 max-w-2xl font-sans text-base text-charcoal/70">
            {guests} hóspede{guests !== 1 ? "s" : ""} · {fmtDate(checkin!)} → {fmtDate(checkout!)}
          </p>
        ) : (
          <p className="mt-4 max-w-2xl font-sans text-base text-charcoal/70">
            Selecione a casa, datas e hóspedes para iniciar a reserva.
          </p>
        )}
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PROPERTIES.map((p) => {
            const total = prices?.[p.slug];
            const href = hasDates
              ? `/reservar?propertyId=${p.slug}&checkin=${checkin}&checkout=${checkout}&guests=${guests}`
              : `/${p.slug}`;

            return (
              <Link
                key={p.slug}
                href={href}
                className="group flex flex-col bg-cream transition-all hover:-translate-y-1"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                  <SmartImage src={p.cardImage} alt={p.name} sizes="(max-width: 1024px) 100vw, 33vw" />
                </div>
                <div className="border-t border-charcoal/10 p-6">
                  <Kicker className="mb-2">{p.badge}</Kicker>
                  <h2 className="font-serif text-2xl text-charcoal">{p.name}</h2>
                  <p className="mt-2 font-sans text-sm text-charcoal/60">
                    Ideal para {p.capacity.ideal} · acomoda até {p.capacity.max}
                  </p>
                  {hasDates && (
                    <p className="mt-3 font-serif text-xl text-charcoal">
                      {total != null ? formatBRLPrecise(total) : "Consulte disponibilidade"}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </Container>
    </main>
  );
}
