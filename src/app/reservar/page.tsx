import Link from "next/link";
import { Metadata } from "next";
import { ArrowLeft, MessageCircle } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import DriveImage from "@/components/ui/DriveImage";
import GuestForm from "@/components/booking/GuestForm";
import { PROPERTIES, getPropertyBySlug } from "@/config/properties";
import { calculatePrice } from "@/lib/hostaway";
import { validateCoupon, SITE, whatsappLink } from "@/config/site";
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
    return <ChooseProperty />;
  }

  const property = getPropertyBySlug(searchParams.propertyId);
  if (!property) return <ChooseProperty />;
  const checkin = searchParams.checkin!;
  const checkout = searchParams.checkout!;
  const guests = Number(searchParams.guests || 2);
  const paymentMethod: "card" | "pix" = searchParams.payment === "pix" ? "pix" : "card";
  const couponCode = (searchParams.coupon || "").trim().toUpperCase();

  const quote = await calculatePrice(property.id, checkin, checkout, guests);

  let couponDiscount = 0;
  let runningTotal = quote?.totalPrice ?? 0;
  if (quote && couponCode) {
    const v = validateCoupon(couponCode, quote.nights, quote.totalPrice);
    if (v.valid) {
      couponDiscount = v.discountAmount;
      runningTotal -= couponDiscount;
    }
  }
  const pixDiscount = paymentMethod === "pix" ? runningTotal * 0.03 : 0;
  runningTotal -= pixDiscount;

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

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
          <section>
            {quote ? (
              <GuestForm
                propertySlug={property.slug}
                checkin={checkin}
                checkout={checkout}
                guests={guests}
                paymentMethod={paymentMethod}
                couponCode={couponCode || undefined}
              />
            ) : (
              <div className="border border-red-300 bg-red-50 p-6 font-sans text-sm text-red-700">
                <p>Não conseguimos calcular o preço para essas datas no momento.</p>
                <p className="mt-2">
                  Por favor, tente outras datas em{" "}
                  <Link href={`/${property.slug}`} className="underline">
                    /{property.slug}
                  </Link>{" "}
                  ou fale com o concierge.
                </p>
                <a
                  href={whatsappLink(`Olá! Tive problema ao reservar o ${property.name} de ${checkin} a ${checkout}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 bg-charcoal px-4 py-2 font-sans text-xs uppercase tracking-widest text-cream"
                >
                  <MessageCircle className="h-4 w-4" /> Falar com o concierge
                </a>
              </div>
            )}
          </section>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="border border-charcoal/10 bg-white">
              <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                <DriveImage
                  fileId={property.heroImageId}
                  alt={property.name}
                  sizes="(max-width: 1024px) 100vw, 40vw"
                />
              </div>
              <div className="p-6">
                <Kicker className="mb-2">{property.badge}</Kicker>
                <h2 className="font-serif text-2xl text-charcoal">{property.name}</h2>
                <ul className="mt-5 space-y-3 border-y border-charcoal/10 py-5 font-sans text-sm">
                  <li className="flex justify-between"><span className="text-charcoal/60">Check-in</span><span className="text-charcoal">{new Date(checkin).toLocaleDateString("pt-BR")}</span></li>
                  <li className="flex justify-between"><span className="text-charcoal/60">Check-out</span><span className="text-charcoal">{new Date(checkout).toLocaleDateString("pt-BR")}</span></li>
                  <li className="flex justify-between"><span className="text-charcoal/60">Hóspedes</span><span className="text-charcoal">{guests}</span></li>
                  {quote && <li className="flex justify-between"><span className="text-charcoal/60">Noites</span><span className="text-charcoal">{quote.nights}</span></li>}
                </ul>

                {quote && (
                  <div className="mt-5 space-y-2 font-sans text-sm">
                    <div className="flex justify-between text-charcoal/80">
                      <span>Subtotal</span>
                      <span>{formatBRLPrecise(quote.totalPrice)}</span>
                    </div>
                    {couponDiscount > 0 && (
                      <div className="flex justify-between text-serra">
                        <span>Cupom {couponCode}</span>
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
                )}
              </div>
            </div>

            <p className="mt-4 text-center font-sans text-xs text-charcoal/50">
              Dúvidas? <a href={whatsappLink("Olá! Estou na etapa de preencher meus dados para reservar.")} target="_blank" rel="noopener noreferrer" className="text-copper underline">{SITE.whatsappDisplay}</a>
            </p>
          </aside>
        </div>
      </Container>
    </main>
  );
}

function ChooseProperty() {
  return (
    <main className="bg-cream pt-32 pb-20">
      <Container>
        <Kicker className="mb-4">Reserva</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">
          Escolha a casa para reservar.
        </Heading>
        <p className="mt-4 max-w-2xl font-sans text-base text-charcoal/70">
          Selecione a casa, datas e hóspedes para iniciar a reserva.
        </p>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PROPERTIES.map((p) => (
            <Link
              key={p.slug}
              href={`/${p.slug}`}
              className="group flex flex-col bg-cream transition-all hover:-translate-y-1"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                <DriveImage fileId={p.cardImageId} alt={p.name} sizes="(max-width: 1024px) 100vw, 33vw" />
              </div>
              <div className="border-t border-charcoal/10 p-6">
                <Kicker className="mb-2">{p.badge}</Kicker>
                <h2 className="font-serif text-2xl text-charcoal">{p.name}</h2>
                <p className="mt-2 font-sans text-sm text-charcoal/60">
                  Ideal para {p.capacity.ideal} · acomoda até {p.capacity.max}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </Container>
    </main>
  );
}
