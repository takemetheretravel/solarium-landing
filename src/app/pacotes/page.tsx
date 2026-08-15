import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import { formatBRL } from "@/lib/cn";
import { pacotesV2Ativo } from "@/config/flags";
import { pacoteVisivelHoje, getPacoteV2 } from "@/config/precos-e-extras";
import { vistaPacote, slugsDePacote } from "@/lib/pricing/vista-pacote";
import { totalMinimoDoPacote } from "@/lib/pricing/pacote-server";
import { getPropertyBySlug } from "@/config/properties";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Pacotes — Solarium Mantiqueira",
  description: "Estadias com itens já organizados, em uma reserva só.",
};

export default async function PaginaPacotes() {
  const v2Ativo = pacotesV2Ativo();
  if (!v2Ativo) notFound();

  const hoje = new Date().toISOString().slice(0, 10);

  const cards = (
    await Promise.all(
      slugsDePacote(v2Ativo).map(async (slug) => {
        const vista = vistaPacote(slug, v2Ativo);
        if (!vista) return null;

        // Sazonal fora da janela não aparece na grade.
        const v2 = getPacoteV2(slug);
        if (v2 && !pacoteVisivelHoje(v2, hoje)) return null;

        const casa = vista.pacoteV2?.properties[0] ?? vista.legado?.properties[0];
        // Total real mínimo do pacote, não a diária solta. O card não pode
        // prometer um número que a página do pacote não entrega.
        // Os cinco pacotes passam pelo mesmo varredor — inclusive os que seguem
        // no motor legado. Nenhum deles cai em "Consultar datas" por falta de
        // suporte do cálculo.
        const minimo = casa
          ? await totalMinimoDoPacote(vista.slug, casa)
          : { total: null as number | null };

        return { vista, minimo };
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <main>
      <Section className="pt-32">
        <Container>
          <div className="mb-16 max-w-2xl">
            <Kicker className="mb-4">Pacotes</Kicker>
            <Heading level={1}>Estadias com tudo já organizado.</Heading>
            <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
              Cada pacote reúne as noites e os itens que a maioria dos hóspedes acaba pedindo, com
              uma condição melhor do que contratar cada coisa à parte.
            </p>
          </div>

          {/* Grade no mesmo tratamento dos cards de casa. O retângulo inteiro é o link. */}
          <div className="grid gap-6 lg:grid-cols-3 lg:gap-6">
            {cards.map(({ vista, minimo }) => (
              <Link
                key={vista.slug}
                href={`/pacotes/${vista.slug}`}
                className="group mb-12 flex flex-col rounded-sm bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 last:mb-0 md:mb-0 md:rounded-none md:bg-cream md:p-0 md:shadow-none"
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-charcoal/5">
                  <SmartImage
                    src={vista.imagem}
                    alt={vista.nome}
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="transition-transform duration-700 group-hover:scale-105"
                  />
                </div>

                <div className="flex flex-1 flex-col pt-6">
                  <Kicker className="mb-3">{vista.noites} noites</Kicker>
                  <Heading level={3} className="text-2xl text-charcoal sm:text-3xl">
                    {vista.nome}
                  </Heading>
                  <p className="mt-3 font-sans text-sm leading-relaxed text-charcoal/70">
                    {vista.tagline}
                  </p>

                  {/* Inclusos com nome e quantidade, sem valores. */}
                  <ul className="mt-5 flex-1 space-y-1">
                    {vista.inclusos.slice(1).map((i) => (
                      <li key={i} className="font-sans text-xs text-charcoal/60">
                        {i}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-6 font-serif text-lg text-charcoal">
                    {minimo.total !== null
                      ? `A partir de ${formatBRL(minimo.total)}`
                      : "Consultar datas"}
                  </p>

                  <span className="mt-4 inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-[0.25em] text-copper transition-colors group-hover:text-charcoal">
                    Ver pacote <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </Section>
    </main>
  );
}
