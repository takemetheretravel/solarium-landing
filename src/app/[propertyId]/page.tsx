import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import { Quote, Check, MessageCircle, ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import DriveImage from "@/components/ui/DriveImage";
import Gallery from "@/components/property/Gallery";
import BookingForm from "@/components/booking/BookingForm";
import { PROPERTIES, getPropertyBySlug } from "@/config/properties";
import { REVIEWS, SITE, whatsappLink } from "@/config/site";
import { getListing } from "@/lib/hostaway";

export const revalidate = 300;

export function generateStaticParams() {
  return PROPERTIES.map((p) => ({ propertyId: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { propertyId: string };
}): Promise<Metadata> {
  const property = getPropertyBySlug(params.propertyId);
  if (!property) return { title: "Não encontrado" };
  return {
    title: `${property.name} — ${property.tagline}`,
    description: property.description.slice(0, 160),
  };
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams: { checkin?: string; checkout?: string; guests?: string };
}) {
  const property = getPropertyBySlug(params.propertyId);
  if (!property) notFound();

  const listing = await getListing(property.id);
  const apiAmenities =
    listing?.listingAmenities?.map((a) => a.amenityName).filter(Boolean) ?? [];
  const amenities = apiAmenities.length > 0 ? apiAmenities : property.amenitiesFallback;
  const propertyReviews = REVIEWS.filter((r) => r.property === property.slug);
  const initialGuests = searchParams?.guests ? Number(searchParams.guests) : 2;

  return (
    <main>
      {/* HERO */}
      <section className="relative h-[80vh] min-h-[560px] w-full overflow-hidden">
        <DriveImage fileId={property.heroImageId} alt={property.name} priority sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 via-transparent to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-start justify-end px-6 pb-20 text-cream sm:px-16 sm:pb-24">
          <Kicker tone="cream" className="mb-4 opacity-90">
            {property.badge.toUpperCase()} · CAPACIDADE {property.capacity}
          </Kicker>
          <Heading level={1} className="text-cream">
            {property.name}
          </Heading>
          <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/85 sm:text-lg">
            {property.tagline}
          </p>
        </div>
      </section>

      {/* GALERIA */}
      <Section spacing="tight">
        <Container size="wide">
          <Gallery imageIds={property.galleryImageIds} altPrefix={property.name} />
        </Container>
      </Section>

      {/* DESCRIÇÃO + BOOKING FORM */}
      <Section spacing="default" className="border-t border-charcoal/10">
        <Container size="wide">
          <div className="grid gap-16 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
            <div>
              <Kicker className="mb-4">Sobre a casa</Kicker>
              <Heading level={2}>
                {property.name}.
                <br />
                <em className="not-italic font-serif italic text-serra">{property.tagline}</em>
              </Heading>
              <p className="mt-8 font-sans text-base leading-[1.8] text-charcoal/80">
                {property.description}
              </p>

              <div className="mt-12">
                <Kicker className="mb-4">Diferenciais</Kicker>
                <ul className="space-y-3 font-sans text-base text-charcoal/80">
                  {property.differentials.map((d) => (
                    <li key={d} className="flex gap-3">
                      <span className="mt-3 h-px w-4 flex-shrink-0 bg-copper" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <aside className="lg:sticky lg:top-28 lg:self-start">
              <BookingForm
                propertySlug={property.slug}
                initialCheckin={searchParams?.checkin}
                initialCheckout={searchParams?.checkout}
                initialGuests={initialGuests}
                maxCapacity={property.capacity}
              />
            </aside>
          </div>
        </Container>
      </Section>

      {/* AMENITIES */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-12 max-w-2xl">
            <Kicker className="mb-4">Comodidades</Kicker>
            <Heading level={2}>Tudo o que você precisa, e mais.</Heading>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {amenities.map((a) => (
              <div
                key={a}
                className="flex items-center gap-3 border-b border-charcoal/5 py-3 font-sans text-sm text-charcoal/80"
              >
                <Check className="h-4 w-4 flex-shrink-0 text-copper" strokeWidth={2} />
                <span>{a}</span>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* REVIEWS */}
      {propertyReviews.length > 0 && (
        <Section id="reviews" className="border-t border-charcoal/10 bg-serra/5">
          <Container>
            <div className="mb-12">
              <Kicker className="mb-4">Avaliações</Kicker>
              <Heading level={2}>Quem ficou aqui.</Heading>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {propertyReviews.map((r) => (
                <article key={r.id} className="bg-cream p-8">
                  <Quote className="h-5 w-5 text-copper" strokeWidth={1.5} />
                  <p className="mt-4 font-serif text-base italic leading-relaxed text-charcoal/85">
                    “{r.text}”
                  </p>
                  <div className="mt-6 border-t border-charcoal/10 pt-4 font-sans text-xs uppercase tracking-[0.2em] text-charcoal/60">
                    <span className="text-charcoal">{r.author}</span>
                    <span className="mx-2 text-charcoal/30">·</span>
                    <span>{r.date}</span>
                    <span className="mx-2 text-charcoal/30">·</span>
                    <span>{r.source}</span>
                  </div>
                </article>
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* CANCELAMENTO */}
      <Section className="border-t border-charcoal/10" spacing="tight">
        <Container size="narrow">
          <Kicker className="mb-4">Política de cancelamento</Kicker>
          <Heading level={3}>Flexível para a sua tranquilidade.</Heading>
          <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
            Cancele com até 14 dias de antecedência e receba reembolso integral. Cancelamentos com menos de 14 dias e mais de 7 dias têm 50% de reembolso. Veja os termos completos para detalhes específicos por temporada.
          </p>
          <Link
            href="/termos#cancelamento"
            className="mt-6 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
          >
            Ler termos completos <ArrowRight className="h-4 w-4" />
          </Link>
        </Container>
      </Section>

      {/* CTA FINAL */}
      <Section className="border-t border-charcoal/10 bg-charcoal text-cream">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Próximo passo</Kicker>
            <Heading level={2} className="text-cream">
              Pronto para reservar {property.name}?
            </Heading>
            <p className="mx-auto mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/70">
              Reserve direto pelo nosso sistema ou fale com o concierge para esclarecer dúvidas.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="#reservar"
                className="bg-copper px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-copper/90"
              >
                Reserve agora
              </Link>
              <a
                href={whatsappLink(`Olá! Tenho interesse no ${property.name}.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-cream/40 px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-cream hover:text-charcoal"
              >
                <MessageCircle className="h-4 w-4" /> Falar com o concierge
              </a>
            </div>
            <p className="mt-6 font-sans text-xs uppercase tracking-[0.25em] text-cream/50">
              {SITE.whatsappDisplay}
            </p>
          </div>
        </Container>
      </Section>
    </main>
  );
}
