import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import { Quote, MessageCircle, ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import Gallery from "@/components/property/Gallery";
import AmenitiesGrouped from "@/components/property/AmenitiesGrouped";
import BookingForm from "@/components/booking/BookingForm";
import VideoBlock from "@/components/ui/VideoBlock";
import {
  PROPERTIES,
  getPropertyBySlug,
  SOLARIUM_COMPLETO_GALLERY_GROUPS,
} from "@/config/properties";
import { REVIEWS, SITE, AIRBNB_LINKS, whatsappLink } from "@/config/site";
import { getListing } from "@/lib/hostaway";

export const revalidate = 300;

const SEO_TITLES: Record<string, string> = {
  "solarium-1": "Solarium 1 — Refúgio para Casais na Serra da Mantiqueira",
  "solarium-2": "Solarium 2 — Cinema e SPA com Vista para a Serra",
  "solarium-completo": "Solarium Completo — Duas Casas, Privacidade Total",
};

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
  const title = SEO_TITLES[property.slug] ?? property.name;
  return {
    title,
    description: property.description.slice(0, 160),
    openGraph: {
      title,
      description: property.description.slice(0, 160),
      images: [{ url: property.heroImage, width: 1600, height: 900, alt: property.name }],
    },
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
  const fullAmenities = apiAmenities.length > 0 ? apiAmenities : property.amenitiesFallback;
  const propertyReviews = REVIEWS.filter((r) => r.property === property.slug);
  const initialGuests = searchParams?.guests ? Number(searchParams.guests) : property.capacity.ideal;
  const isCompleto = property.slug === "solarium-completo";

  const airbnbUrl = AIRBNB_LINKS[property.slug] || "";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: `${property.name} — Solarium Mantiqueira`,
    description: property.description.slice(0, 300),
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://solariummantiqueira.com"}/${property.slug}`,
    image: property.heroImage,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Itanhandu",
      addressRegion: "MG",
      addressCountry: "BR",
    },
    priceRange: "R$$",
    telephone: `+${SITE.whatsappNumber}`,
    amenityFeature: fullAmenities.slice(0, 20).map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    })),
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* HERO */}
      <section className="relative h-[80vh] min-h-[560px] w-full overflow-hidden">
        <SmartImage src={property.heroImage} alt={property.name} priority sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 via-transparent to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-start justify-end px-6 pb-20 text-cream sm:px-16 sm:pb-24">
          <Kicker tone="cream" className="mb-4 opacity-90">
            {property.badge.toUpperCase()} · IDEAL PARA {property.capacity.ideal} · ACOMODA ATÉ {property.capacity.max}
          </Kicker>
          <Heading level={1} className="text-cream">
            {property.name}
          </Heading>
          <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/85 sm:text-lg">
            {property.tagline}
          </p>
        </div>
      </section>

      {/* VÍDEO */}
      {property.videoPublicId && (
        <section className="border-t border-charcoal/10 bg-cream">
          <Container size="wide">
            <div className="grid grid-cols-1 items-stretch lg:grid-cols-[400px_1fr]">
              {/* Vídeo portrait à esquerda */}
              <div className="flex items-stretch bg-charcoal">
                <VideoBlock
                  publicId={property.videoPublicId}
                  orientation="portrait"
                  className="min-h-[500px] w-full"
                />
              </div>
              {/* Texto à direita */}
              <div className="flex flex-col justify-center bg-white p-10 md:p-14">
                <Kicker className="mb-3">Conheça em movimento</Kicker>
                <Heading level={2} className="mb-5">
                  Veja como é se hospedar aqui.
                </Heading>
                <p className="font-sans text-base leading-relaxed text-charcoal/70">
                  Um reel com os melhores momentos de uma estadia. Clique para assistir com som.
                </p>
              </div>
            </div>
          </Container>
        </section>
      )}

      {/* GALERIA */}
      <Section spacing="tight">
        <Container size="wide">
          {isCompleto ? (
            <div className="space-y-12">
              {SOLARIUM_COMPLETO_GALLERY_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-5 font-serif text-xl text-charcoal/70">{group.title}</h3>
                  <Gallery images={group.images} altPrefix={`${property.name} — ${group.title}`} />
                </div>
              ))}
            </div>
          ) : (
            <Gallery images={property.galleryImages} altPrefix={property.name} />
          )}
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
              <p className="mt-4 font-serif text-lg text-charcoal/80">
                Ideal para <strong className="font-serif">{property.capacity.ideal} hóspedes</strong>. Acomoda até {property.capacity.max}.
              </p>
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
                maxCapacity={property.capacity.max}
                idealCapacity={property.capacity.ideal}
              />
            </aside>
          </div>
        </Container>
      </Section>

      {/* COMODIDADES */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-12 max-w-2xl">
            <Kicker className="mb-4">Comodidades</Kicker>
            <Heading level={2}>Tudo o que você precisa, e mais.</Heading>
          </div>
          <AmenitiesGrouped groups={property.amenityGroups} fullList={fullAmenities} />
        </Container>
      </Section>

      {/* REVIEWS */}
      {propertyReviews.length > 0 && (
        <Section id="reviews" className="border-t border-charcoal/10 bg-serra/5">
          <Container>
            <div className="mb-12 flex items-end justify-between gap-6">
              <div>
                <Kicker className="mb-4">Avaliações</Kicker>
                <Heading level={2}>Quem ficou aqui.</Heading>
              </div>
              {airbnbUrl && (
                <a
                  href={airbnbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 font-sans text-xs uppercase tracking-[0.2em] text-charcoal/50 hover:text-copper"
                >
                  Ver no Airbnb →
                </a>
              )}
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
            Cancelamento sem custo em até 7 dias após a confirmação da reserva, desde que reste pelo menos 24h antes do check-in. Reagendamentos podem ser solicitados com 15 dias de antecedência. Veja os termos completos para detalhes específicos.
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
