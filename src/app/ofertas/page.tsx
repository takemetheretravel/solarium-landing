import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Tag, Percent, MessageCircle } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { COUPONS } from "@/config/coupons";
import { SITE, whatsappLink } from "@/config/site";

export const metadata: Metadata = {
  title: "Ofertas e Cupons",
  description:
    "Cupons de desconto exclusivos para reservas diretas no Solarium Mantiqueira. Economize na sua próxima estadia na Serra da Mantiqueira.",
};

export default function OfertasPage() {
  const publicCoupons = COUPONS.filter((c) => c.isPublic);

  return (
    <main>
      <section className="border-b border-charcoal/10 bg-charcoal pt-32 pb-20 text-cream">
        <Container size="narrow">
          <Kicker tone="copper" className="mb-4">
            Reservas diretas
          </Kicker>
          <Heading level={1} className="text-cream">
            Ofertas exclusivas.
          </Heading>
          <p className="mt-6 font-sans text-base leading-relaxed text-cream/75">
            Quanto mais tempo conosco, melhor o preço da sua estadia.
          </p>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="mb-14 max-w-2xl">
            <Kicker className="mb-4">Cupons ativos</Kicker>
            <Heading level={2}>Use no checkout — é grátis.</Heading>
            <p className="mt-4 font-sans text-sm leading-relaxed text-charcoal/70">
              Copie o código e cole no campo "Tem um cupom?" durante o processo de reserva. Os
              descontos são aplicados automaticamente sobre o valor das diárias.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {publicCoupons.map((coupon) => (
              <article
                key={coupon.code}
                className="relative flex flex-col border border-charcoal/10 bg-cream p-8"
              >
                <div className="mb-6 flex items-start justify-between">
                  <Percent className="h-6 w-6 text-copper" strokeWidth={1.5} />
                  <span className="font-sans text-xs uppercase tracking-[0.25em] text-charcoal/40">
                    Reserva direta
                  </span>
                </div>

                <p className="font-sans text-xs uppercase tracking-[0.2em] text-charcoal/50">
                  {coupon.minNights}+ noites
                </p>
                <p className="mt-1 font-serif text-4xl text-charcoal">
                  {coupon.discount}
                  <span className="text-2xl text-copper">%</span>
                </p>
                <p className="mt-1 font-sans text-sm text-charcoal/70">{coupon.description}</p>

                <div className="mt-8 flex items-center gap-3 border-t border-charcoal/10 pt-5">
                  <Tag className="h-4 w-4 flex-shrink-0 text-copper" strokeWidth={1.5} />
                  <code className="select-all font-mono text-sm font-semibold tracking-widest text-charcoal">
                    {coupon.code}
                  </code>
                </div>

                {coupon.maxInstallments && (
                  <p className="mt-3 font-sans text-xs text-charcoal/50">
                    Cartão: até {coupon.maxInstallments}x
                  </p>
                )}
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="border-t border-charcoal/10 bg-cream">
        <Container>
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
            <div>
              <Kicker className="mb-4">Como usar</Kicker>
              <Heading level={2}>Em 3 passos simples.</Heading>
              <ol className="mt-10 space-y-8">
                {[
                  {
                    n: "01",
                    title: "Escolha sua casa e datas",
                    text: "Selecione o Solarium 1, Solarium 2 ou o Solarium Completo e informe o período.",
                  },
                  {
                    n: "02",
                    title: 'Clique em "Tem um cupom?"',
                    text: "No resumo de valores, expanda a seção de cupom e cole o código.",
                  },
                  {
                    n: "03",
                    title: "Finalize com Pix ou cartão",
                    text: "Escolha o método de pagamento de preferência e conclua a reserva.",
                  },
                ].map((step) => (
                  <li key={step.n} className="flex gap-6">
                    <span className="mt-0.5 font-serif text-3xl text-copper/40 leading-none">
                      {step.n}
                    </span>
                    <div>
                      <h3 className="font-serif text-xl text-charcoal">{step.title}</h3>
                      <p className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">
                        {step.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col justify-center">
              <div className="border border-charcoal/10 p-10">
                <Kicker className="mb-4">Dúvidas?</Kicker>
                <Heading level={3}>Fale com o concierge.</Heading>
                <p className="mt-4 font-sans text-sm leading-relaxed text-charcoal/70">
                  Se tiver dúvidas sobre como aplicar um cupom ou sobre qualquer aspecto da
                  reserva, fale diretamente conosco.
                </p>
                <a
                  href={whatsappLink("Olá! Tenho uma dúvida sobre os cupons de desconto do Solarium.")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex items-center gap-2 bg-copper px-8 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-copper/90"
                >
                  <MessageCircle className="h-4 w-4" /> Falar no WhatsApp
                </a>
                <p className="mt-4 font-sans text-xs text-charcoal/50">{SITE.whatsappDisplay}</p>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="border-t border-charcoal/10 bg-charcoal" spacing="tight">
        <Container size="narrow">
          <div className="text-center">
            <Kicker tone="copper" className="mb-4">Reservar agora</Kicker>
            <Heading level={2} className="text-cream">
              Pronto para sua estadia?
            </Heading>
            <p className="mx-auto mt-4 max-w-md font-sans text-sm text-cream/70">
              Reserve pelo nosso site, aplique seu cupom e garanta o melhor preço.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/solarium-1"
                className="bg-copper px-8 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-copper/90"
              >
                Solarium 1 <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
              </Link>
              <Link
                href="/solarium-2"
                className="border border-cream/30 px-8 py-4 font-sans text-xs uppercase tracking-[0.3em] text-cream hover:bg-cream hover:text-charcoal"
              >
                Solarium 2
              </Link>
            </div>
          </div>
        </Container>
      </Section>
    </main>
  );
}
