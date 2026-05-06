import Link from "next/link";
import { Metadata } from "next";
import { ArrowRight, MessageCircle, Coffee, Heart, Flower2, MapPin } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import {
  EXPERIENCES_ONSITE,
  EXPERIENCES_REGION,
  whatsappLink,
} from "@/config/site";

export const metadata: Metadata = {
  title: "Experiências",
  description:
    "Curadoria de experiências no Solarium e na região: cesta de café local, massagens, decoração, aventura, cachoeiras, queijos artesanais e cultura.",
};

const ONSITE_ICONS = { coffee: Coffee, spa: Flower2, heart: Heart };

export default function ExperienciasPage() {
  return (
    <main>
      <section className="relative h-[60vh] min-h-[420px] w-full overflow-hidden">
        <SmartImage
          src="/images/solarium-1/03-cafe-na-rede.jpg"
          alt="Café da manhã na rede com vista para a serra"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-20 text-center text-cream">
          <Kicker tone="cream" className="mb-4 opacity-90">Experiências</Kicker>
          <Heading level={1} className="text-cream">
            Sua experiência,<br />
            <em className="not-italic font-serif italic">nossa curadoria.</em>
          </Heading>
        </div>
      </section>

      <Section spacing="tight">
        <Container size="narrow">
          <p className="text-center font-serif text-xl leading-relaxed text-charcoal/80 sm:text-2xl">
            Do amanhecer com café local na rede ao mergulho em cachoeiras de água gelada — cuidamos para que cada momento da sua estadia seja seu.
          </p>
        </Container>
      </Section>

      {/* NO SOLARIUM */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="mb-12 max-w-2xl">
            <Kicker className="mb-4">No Solarium</Kicker>
            <Heading level={2}>Experiências na sua casa.</Heading>
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {EXPERIENCES_ONSITE.map((e) => {
              const Icon = ONSITE_ICONS[e.icon];
              return (
                <article key={e.title} className="border-t border-copper/30 pt-6">
                  <Icon className="h-7 w-7 text-copper" strokeWidth={1.5} />
                  <h3 className="mt-5 font-serif text-2xl leading-tight text-charcoal">
                    {e.title}
                  </h3>
                  <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                    {e.description}
                  </p>
                </article>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* NA REGIÃO */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Na região</Kicker>
            <Heading level={2}>O que está ao redor.</Heading>
            <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
              Selecionamos os roteiros que vivenciamos e que recomendamos sem hesitar — de aventura a gastronomia.
            </p>
          </div>

          <div className="space-y-16">
            {EXPERIENCES_REGION.map((cat) => (
              <div key={cat.category}>
                <div className="mb-8 flex items-center gap-4">
                  <h3 className="font-serif text-3xl text-charcoal">{cat.category}</h3>
                  <span className="h-px flex-1 bg-charcoal/10" />
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {cat.items.map((item) => (
                    <article
                      key={item.title}
                      className="border-l-2 border-copper/40 pl-5 transition-colors hover:border-copper"
                    >
                      <h4 className="font-serif text-xl text-charcoal">{item.title}</h4>
                      {item.distance && (
                        <p className="mt-1 inline-flex items-center gap-1 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-copper">
                          <MapPin className="h-3 w-3" /> {item.distance}
                        </p>
                      )}
                      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">
                        {item.description}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* CONCIERGE CTA */}
      <Section className="border-t border-charcoal/10 bg-serra text-cream" spacing="tight">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Concierge personalizado</Kicker>
            <Heading level={2} className="text-cream">
              Vamos planejar a sua experiência juntos.
            </Heading>
            <p className="mx-auto mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/80">
              Conte um pouco do que você imagina e nós combinamos os detalhes — reservas, transporte, agenda.
            </p>
            <a
              href={whatsappLink("Olá! Gostaria de planejar minha experiência no Solarium Mantiqueira.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 inline-flex items-center gap-2 bg-copper px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-cream hover:text-charcoal"
            >
              <MessageCircle className="h-4 w-4" /> Falar no WhatsApp <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </Container>
      </Section>
    </main>
  );
}
