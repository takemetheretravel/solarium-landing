import Link from "next/link";
import { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import DriveImage from "@/components/ui/DriveImage";
import { PROPERTIES } from "@/config/properties";
import { calculatePrice } from "@/lib/hostaway";
import { formatBRLPrecise } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Verificar disponibilidade",
  description: "Veja a disponibilidade e preços ao vivo das nossas três opções de hospedagem.",
};

export const dynamic = "force-dynamic";

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: { checkin?: string; checkout?: string; guests?: string };
}) {
  const { checkin, checkout } = searchParams;
  const guests = Number(searchParams.guests || 2);

  const quotes = checkin && checkout
    ? await Promise.all(
        PROPERTIES.map((p) =>
          calculatePrice(p.id, checkin, checkout, guests).catch(() => null),
        ),
      )
    : [];

  return (
    <main className="pt-32 pb-20">
      <Container>
        <Kicker className="mb-4">Disponibilidade</Kicker>
        <Heading level={1} className="text-4xl sm:text-6xl">
          Selecione a casa ideal.
        </Heading>
        {checkin && checkout ? (
          <p className="mt-6 font-sans text-base text-charcoal/70">
            Datas: <strong>{new Date(checkin).toLocaleDateString("pt-BR")}</strong> →{" "}
            <strong>{new Date(checkout).toLocaleDateString("pt-BR")}</strong> · {guests}{" "}
            {guests === 1 ? "hóspede" : "hóspedes"}
          </p>
        ) : (
          <p className="mt-6 font-sans text-base text-charcoal/70">
            Selecione datas pelo formulário da home para ver preços ao vivo.
          </p>
        )}

        <Section spacing="tight">
          <div className="grid gap-8 lg:grid-cols-3">
            {PROPERTIES.map((p, i) => {
              const quote = quotes[i];
              const linkParams = new URLSearchParams();
              if (checkin) linkParams.set("checkin", checkin);
              if (checkout) linkParams.set("checkout", checkout);
              linkParams.set("guests", String(guests));
              const fits = guests <= p.capacity;

              return (
                <Link
                  key={p.slug}
                  href={`/${p.slug}?${linkParams.toString()}`}
                  className="group flex flex-col bg-cream transition-all hover:-translate-y-1"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                    <DriveImage
                      fileId={p.heroImageId}
                      alt={p.name}
                      sizes="(max-width: 1024px) 100vw, 33vw"
                    />
                    {!fits && (
                      <span className="absolute right-3 top-3 bg-charcoal/90 px-3 py-1.5 font-sans text-[0.6rem] uppercase tracking-[0.2em] text-cream">
                        Capacidade insuficiente
                      </span>
                    )}
                  </div>
                  <div className="border-t border-charcoal/10 p-6">
                    <Kicker className="mb-2">{p.badge}</Kicker>
                    <Heading level={3} className="text-2xl">{p.name}</Heading>
                    <p className="mt-2 font-sans text-sm text-charcoal/60">Capacidade {p.capacity}</p>

                    {quote ? (
                      <div className="mt-6 border-t border-charcoal/10 pt-4">
                        <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
                          Total {quote.nights} {quote.nights === 1 ? "noite" : "noites"}
                        </span>
                        <p className="mt-1 font-serif text-3xl text-charcoal">
                          {formatBRLPrecise(quote.totalPrice)}
                        </p>
                      </div>
                    ) : checkin && checkout ? (
                      <p className="mt-6 border-t border-charcoal/10 pt-4 font-sans text-sm text-charcoal/60">
                        Indisponível para essas datas.
                      </p>
                    ) : (
                      <p className="mt-6 border-t border-charcoal/10 pt-4 font-sans text-sm text-charcoal/60">
                        A partir de R$ — / noite
                      </p>
                    )}

                    <span className="mt-6 inline-flex items-center gap-1 font-sans text-xs uppercase tracking-[0.25em] text-copper transition-transform group-hover:translate-x-1">
                      Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Section>
      </Container>
    </main>
  );
}
