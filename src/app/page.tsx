import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  Cpu,
  Waves,
  Heart,
  Coffee,
  Flower2,
  Tag,
  MessageCircle,
} from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import BookingBar from "@/components/booking/BookingBar";
import ReviewsMarquee from "@/components/ui/ReviewsMarquee";
import FAQ from "@/components/ui/FAQ";
import { PROPERTIES } from "@/config/properties";
import {
  REVIEWS,
  PARTNERS,
  EXPERIENCES_ONSITE,
  SITE,
  AIRBNB_LINKS,
  whatsappLink,
} from "@/config/site";
import { getMinNightlyFromCalendar } from "@/lib/hostaway";
import { formatBRL } from "@/lib/cn";

export const revalidate = 300;

const ONSITE_ICONS = { coffee: Coffee, spa: Flower2, heart: Heart };

const MARQUEE_REVIEW_IDS = [1, 2, 3, 4, 5, 9, 10, 14];

export default async function Home() {
  const minPrices = await Promise.all(
    PROPERTIES.map((p) => getMinNightlyFromCalendar(p.id, 90).catch(() => null)),
  );
  const marqueeReviews = MARQUEE_REVIEW_IDS
    .map((id) => REVIEWS.find((r) => r.id === id))
    .filter((r): r is (typeof REVIEWS)[number] => Boolean(r));
  const featuredPartners = PARTNERS.slice(1);
  const flagshipPartner = PARTNERS[0];

  return (
    <main>
      {/* HERO */}
      <section className="relative h-screen min-h-[640px] w-full overflow-hidden">
        <SmartImage
          src="/images/comum/hero-banheira-por-do-sol.jpg"
          alt="SPA com piscina infinita aquecida e vista para a Serra da Mantiqueira ao pôr do sol"
          priority
          sizes="100vw"
          className="object-[70%_center] md:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/55 via-charcoal/20 to-transparent sm:from-charcoal/40" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center text-cream">
          <Kicker tone="cream" className="mb-6 opacity-90">{SITE.region}</Kicker>
          <Heading level={1} className="text-cream">
            Solarium
            <br />
            <em className="not-italic font-serif italic text-cream/95">Mantiqueira</em>
          </Heading>
          <p className="mx-auto mt-8 max-w-xl font-sans text-base leading-relaxed text-cream/90 sm:text-lg">
            Refúgio de design e experiência. Duas casas pensadas para casais e momentos especiais, em integração com a serra.
          </p>
          <Link
            href="#busca"
            className="mt-12 inline-flex items-center gap-2 bg-copper px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream transition-colors hover:bg-copper/90"
          >
            Verificar disponibilidade <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-cream/70">
          <span className="font-sans text-[0.6rem] uppercase tracking-[0.4em]">role</span>
          <span className="h-12 w-px bg-cream/40" />
        </div>
      </section>

      {/* POR QUE RESERVAR DIRETO */}
      <Section spacing="default" className="border-b border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Reservas diretas</Kicker>
            <Heading level={2}>As vantagens de reservar pelo nosso site.</Heading>
          </div>
          <div className="grid grid-cols-2 gap-10 lg:grid-cols-4 lg:gap-8">
            {[
              { icon: Tag, title: "Até 17% de desconto", text: "Estadias mais longas têm preços melhores — desconto progressivo por noite." },
              { icon: Sparkles, title: "Cupons exclusivos", text: "Códigos de desconto disponíveis para reservas diretas." },
              { icon: MessageCircle, title: "Atendimento direto com o anfitrião", text: "Sem intermediários, sem fila — falamos com você." },
              { icon: Sparkles, title: "Concierge proativo", text: "Da chegada à partida, cuidamos dos detalhes." },
            ].map((item) => (
              <div key={item.title}>
                <item.icon className="h-7 w-7 text-copper" strokeWidth={1.5} />
                <h3 className="mt-5 font-serif text-xl leading-tight text-charcoal">
                  {item.title}
                </h3>
                <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* BANNER CUPONS */}
      <div className="border-b border-charcoal/10 bg-charcoal/5 py-4">
        <Container>
          <div className="mx-auto flex max-w-xl flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-3">
              <Tag className="h-4 w-4 flex-shrink-0 text-copper" strokeWidth={1.5} />
              <p className="font-sans text-xs text-charcoal/70">
                Cupons exclusivos: até 17% de desconto para reservas diretas.
              </p>
            </div>
            <Link
              href="/ofertas"
              className="flex-shrink-0 inline-flex items-center gap-1 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
            >
              Ver cupons <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Container>
      </div>

      {/* NOSSAS CASAS */}
      <Section id="nossas-casas">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Nossas casas</Kicker>
            <Heading level={2}>Duas casas, infinitas possibilidades.</Heading>
            <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
              Reserve uma casa para um refúgio íntimo a dois ou as duas para uma experiência completamente privativa.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3 lg:gap-6">
            {PROPERTIES.map((p, i) => {
              const min = minPrices[i];
              return (
                <Link
                  key={p.slug}
                  href={`/${p.slug}`}
                  className="group mb-12 flex flex-col rounded-sm bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 last:mb-0 md:mb-0 md:rounded-none md:bg-cream md:p-0 md:shadow-none"
                >
                  <div className="relative aspect-[4/5] overflow-hidden bg-charcoal/5">
                    <SmartImage
                      src={p.cardImage}
                      alt={p.name}
                      sizes="(max-width: 1024px) 100vw, 33vw"
                    />
                    <span className="absolute left-4 top-4 bg-cream/95 px-3 py-1.5 font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal">
                      {p.badge}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col pt-6">
                    <Heading level={3} className="text-2xl text-charcoal sm:text-3xl">
                      {p.name}
                    </Heading>
                    <p className="mt-2 font-serif text-base text-charcoal">
                      Ideal para {p.capacity.ideal} hóspedes
                    </p>
                    <p className="font-sans text-xs text-charcoal/55">
                      Acomoda até {p.capacity.max}
                    </p>
                    <ul className="mt-6 space-y-2 font-sans text-sm text-charcoal/80">
                      {p.differentials.slice(0, 3).map((d) => (
                        <li key={d} className="flex gap-2">
                          <span className="mt-2 h-px w-3 flex-shrink-0 bg-copper" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-6 flex items-baseline justify-between border-t border-charcoal/10 pt-4">
                      <div>
                        {min ? (
                          <>
                            <span className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">A partir de</span>
                            <p className="font-serif text-2xl text-charcoal">
                              {formatBRL(min)}
                              <span className="ml-1 font-sans text-xs lowercase tracking-normal text-charcoal/60">/ noite</span>
                            </p>
                          </>
                        ) : (
                          <span className="font-sans text-xs text-charcoal/60">Consulte preços</span>
                        )}
                      </div>
                      <span className="flex items-center gap-1 font-sans text-xs uppercase tracking-[0.2em] text-copper transition-transform group-hover:translate-x-1">
                        Conhecer <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* BOOKING BAR */}
      <Section id="busca" spacing="tight" className="bg-cream">
        <Container>
          <div className="flex flex-col items-center">
            <Kicker className="mb-4">Verificar disponibilidade</Kicker>
            <Heading level={3} className="mb-8 text-center">
              Selecione suas datas para ver as casas livres.
            </Heading>
            <BookingBar />
          </div>
        </Container>
      </Section>

      {/* POR QUE SOLARIUM */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Por que Solarium</Kicker>
            <Heading level={2}>Detalhes que mudam tudo.</Heading>
          </div>
          <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {[
              { icon: Sparkles, title: "Design integrado à natureza", text: "Cada ambiente foi pensado para emoldurar a vista da Serra da Mantiqueira." },
              { icon: Cpu, title: "Tecnologia que serve a quem está aqui", text: "Alexa, piso aquecido, película inteligente. Conforto sem fricção." },
              { icon: Waves, title: "SPA com piscina infinita aquecida", text: "Águas aquecidas o ano inteiro, com vista para a Serra Fina." },
              { icon: Heart, title: "Concierge proativo", text: "Cuidamos dos detalhes para que você só precise estar presente." },
            ].map((item) => (
              <div key={item.title}>
                <item.icon className="h-7 w-7 text-copper" strokeWidth={1.5} />
                <h3 className="mt-5 font-serif text-2xl leading-tight text-charcoal">
                  {item.title}
                </h3>
                <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* REVIEWS — MARQUEE */}
      <Section className="bg-serra/5">
        <Container>
          <div className="mb-12 flex flex-col items-center text-center">
            <Kicker className="mb-4">O que nossos hóspedes dizem</Kicker>
            <Heading level={2} className="max-w-3xl">
              Dezenas de momentos memoráveis, contados por quem viveu.
            </Heading>
          </div>
        </Container>
        <ReviewsMarquee reviews={marqueeReviews} />
        <div className="mt-12 text-center">
          <p className="font-sans text-sm text-charcoal/60 mb-5">
            Mais de 47 avaliações 5 estrelas em diferentes plataformas
          </p>
          <div className="flex flex-wrap justify-center gap-6">
            {[
              { label: "Ver Solarium 1 no Airbnb", url: AIRBNB_LINKS["solarium-1"] },
              { label: "Ver Solarium 2 no Airbnb", url: AIRBNB_LINKS["solarium-2"] },
              { label: "Ver Solarium Completo no Airbnb", url: AIRBNB_LINKS["solarium-completo"] },
            ].map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans text-xs uppercase tracking-widest text-copper underline underline-offset-4 hover:text-copper/80"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </Section>

      {/* EXPERIÊNCIAS */}
      <Section className="border-t border-charcoal/10">
        <Container>
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
            <div className="relative aspect-[4/5] overflow-hidden">
              <SmartImage
                src="/images/solarium-1/03-cafe-na-rede.jpg"
                alt="Café da manhã na rede com vista para a serra"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="flex flex-col justify-center">
              <Kicker className="mb-4">Experiências</Kicker>
              <Heading level={2}>Sua experiência, nossa curadoria.</Heading>
              <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
                Da cesta de café da manhã preparada com produtores locais à decoração para sua data especial — cuidamos para que cada detalhe seja seu.
              </p>
              <div className="mt-10 grid gap-8 sm:grid-cols-3">
                {EXPERIENCES_ONSITE.map((e) => {
                  const Icon = ONSITE_ICONS[e.icon];
                  return (
                    <div key={e.title}>
                      <Icon className="h-6 w-6 text-copper" strokeWidth={1.5} />
                      <h3 className="mt-4 font-serif text-xl text-charcoal">{e.title}</h3>
                      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">{e.description}</p>
                    </div>
                  );
                })}
              </div>
              <Link
                href="/experiencias"
                className="mt-10 inline-flex items-center gap-2 self-start font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
              >
                Explorar a região <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Container>
      </Section>

      {/* PARCEIROS */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Parceiros</Kicker>
            <Heading level={2}>Os nomes por trás da experiência.</Heading>
          </div>

          <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            <div className="bg-charcoal p-10 text-cream lg:col-span-1">
              <Kicker tone="copper" className="mb-4">{flagshipPartner.category}</Kicker>
              <Heading level={3} className="text-cream">{flagshipPartner.name}</Heading>
              <p className="mt-6 font-sans text-sm leading-relaxed text-cream/80">{flagshipPartner.description}</p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:col-span-2">
              {featuredPartners.slice(0, 4).map((p) => (
                <div key={p.name} className="border border-charcoal/10 p-6">
                  <Kicker className="mb-2">{p.category}</Kicker>
                  <h3 className="font-serif text-xl text-charcoal">{p.name}</h3>
                  <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                    {p.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/parceiros"
              className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
            >
              Conhecer todos os parceiros <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container size="narrow">
          <div className="mb-12">
            <Kicker className="mb-4">Dúvidas frequentes</Kicker>
            <Heading level={2}>Antes de reservar.</Heading>
          </div>
          <FAQ />
        </Container>
      </Section>

      {/* CTA WHATSAPP */}
      <Section className="border-t border-charcoal/10 bg-serra text-cream" spacing="tight">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Concierge</Kicker>
            <Heading level={2} className="text-cream">
              Tem uma dúvida ou um pedido especial?
            </Heading>
            <p className="mx-auto mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/80">
              Falamos pessoalmente com cada hóspede. Mande mensagem que respondemos rápido.
            </p>
            <a
              href={whatsappLink("Olá! Gostaria de saber mais sobre o Solarium Mantiqueira.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 inline-flex items-center gap-2 bg-copper px-9 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream transition-colors hover:bg-cream hover:text-charcoal"
            >
              Falar no WhatsApp <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </Container>
      </Section>
    </main>
  );
}
