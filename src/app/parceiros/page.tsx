import { Metadata } from "next";
import { AtSign, MessageCircle, Tag } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import DriveImage from "@/components/ui/DriveImage";
import { PARTNERS, instagramLink } from "@/config/site";

export const metadata: Metadata = {
  title: "Parceiros",
  description:
    "Os parceiros que tornam o Solarium Mantiqueira possível: gestão, paisagismo, conforto, hotelaria, mobiliário e tecnologia.",
};

function partnerWhatsappLink(p: typeof PARTNERS[number]) {
  if (!p.whatsapp || !p.whatsappMessage) return null;
  return `https://wa.me/${p.whatsapp}?text=${encodeURIComponent(p.whatsappMessage)}`;
}

export default function ParceirosPage() {
  const flagship = PARTNERS[0];
  const others = PARTNERS.slice(1);

  return (
    <main>
      <section className="relative h-[55vh] min-h-[400px] w-full overflow-hidden">
        <DriveImage
          fileId="1Dsan8yfE0CCrWd1H082S2SgRhG6HIfbO"
          alt="Detalhes da casa em integração com a serra"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-center justify-end px-6 pb-16 text-center text-cream">
          <Kicker tone="cream" className="mb-4 opacity-90">Parceiros</Kicker>
          <Heading level={1} className="text-cream">
            Quem caminha<br />
            <em className="not-italic font-serif italic">com a gente.</em>
          </Heading>
        </div>
      </section>

      <Section spacing="tight">
        <Container size="narrow">
          <p className="text-center font-serif text-xl leading-relaxed text-charcoal/80 sm:text-2xl">
            Cada parceiro foi escolhido por compartilhar nosso compromisso com excelência, design e atenção aos detalhes. Eles são parte da experiência Solarium.
          </p>
        </Container>
      </Section>

      {/* FLAGSHIP */}
      <Section className="border-t border-charcoal/10" spacing="tight">
        <Container>
          <article className="bg-charcoal p-10 text-cream md:p-16">
            <Kicker tone="copper" className="mb-4">{flagship.category}</Kicker>
            <Heading level={2} className="text-cream">{flagship.name}</Heading>
            <p className="mt-8 max-w-3xl font-sans text-lg leading-relaxed text-cream/85">
              {flagship.description}
            </p>
          </article>
        </Container>
      </Section>

      {/* OUTROS PARCEIROS */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="mb-12 max-w-2xl">
            <Kicker className="mb-4">Rede de parceiros</Kicker>
            <Heading level={2}>Os nomes que tornam o Solarium possível.</Heading>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {others.map((p) => {
              const wa = partnerWhatsappLink(p);
              return (
                <article key={p.name} className="flex flex-col border border-charcoal/10 bg-cream p-8">
                  <Kicker className="mb-3">{p.category}</Kicker>
                  <h3 className="font-serif text-2xl text-charcoal">{p.name}</h3>
                  <p className="mt-4 flex-1 font-sans text-sm leading-relaxed text-charcoal/75">
                    {p.description}
                  </p>

                  {p.couponCode && (
                    <div className="mt-6 flex items-center gap-2 border border-copper/40 bg-copper/10 px-3 py-2 font-sans text-xs">
                      <Tag className="h-3.5 w-3.5 text-copper" />
                      <span className="uppercase tracking-widest text-copper">{p.couponCode}</span>
                      <span className="text-charcoal/70">— {p.couponDescription}</span>
                    </div>
                  )}

                  <div className="mt-6 flex flex-wrap gap-3">
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-charcoal px-4 py-2 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-cream hover:bg-serra"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    )}
                    {p.instagram && (
                      <a
                        href={instagramLink(p.instagram)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 border border-charcoal/30 px-4 py-2 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
                      >
                        <AtSign className="h-3.5 w-3.5" /> @{p.instagram}
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Container>
      </Section>
    </main>
  );
}
