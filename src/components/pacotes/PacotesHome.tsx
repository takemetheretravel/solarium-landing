import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import { formatBRL } from "@/lib/cn";
import { PACOTES_V2, pacoteVisivelHoje } from "@/config/precos-e-extras";
import { vistaPacote } from "@/lib/pricing/vista-pacote";
import { diariaMinima } from "@/lib/pricing/pacote-server";

/**
 * Bloco de pacotes da home. No máximo 3 cards — o teto é regra da home; /pacotes
 * lista todos.
 *
 * Prioridade: Fim de Semana Completo → Dois Casais, Uma Vista → Feriado na Serra
 * quando estiver na janela sazonal; fora dela, Meio de Semana na Serra.
 */
export default async function PacotesHome() {
  const hoje = new Date().toISOString().slice(0, 10);

  const prioritarios = PACOTES_V2.filter((p) => p.ativo && pacoteVisivelHoje(p, hoje))
    .sort((a, b) => a.prioridadeHome - b.prioridadeHome)
    .map((p) => p.slug);

  // Fora da janela de feriado sobra espaço: o Meio de Semana entra como terceiro.
  const slugs = [...prioritarios];
  if (slugs.length < 3) slugs.push("meio-de-semana");

  const cards = (
    await Promise.all(
      slugs.slice(0, 3).map(async (slug) => {
        const vista = vistaPacote(slug, true);
        if (!vista) return null;
        const casa = vista.pacoteV2?.properties[0] ?? vista.legado?.properties[0];
        const minima = casa ? await diariaMinima(casa) : null;
        return { vista, minima };
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  if (cards.length === 0) return null;

  return (
    <Section id="pacotes" className="border-t border-charcoal/10 bg-cream">
      <Container>
        <div className="mb-16 max-w-2xl">
          <Kicker className="mb-4">Pacotes</Kicker>
          <Heading level={2}>Estadias com tudo já organizado.</Heading>
          <p className="mt-6 font-sans text-base leading-relaxed text-charcoal/70">
            As noites e os itens que a maioria dos hóspedes acaba pedindo, em uma reserva só.
          </p>
        </div>

        {/* Card inteiro clicável, mesmo tratamento dos cards de casa. */}
        <div className="grid gap-6 lg:grid-cols-3 lg:gap-6">
          {cards.map(({ vista, minima }) => (
            <Link
              key={vista.slug}
              href={`/pacotes/${vista.slug}`}
              className="group mb-12 flex flex-col rounded-sm bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 last:mb-0 md:mb-0 md:rounded-none md:bg-transparent md:p-0 md:shadow-none"
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
                <p className="mt-3 flex-1 font-sans text-sm leading-relaxed text-charcoal/70">
                  {vista.tagline}
                </p>

                {minima !== null && (
                  <p className="mt-6 font-serif text-lg text-charcoal">
                    A partir de {formatBRL(minima * vista.noites)}
                  </p>
                )}

                <span className="mt-4 inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-[0.25em] text-copper transition-colors group-hover:text-charcoal">
                  Ver pacote <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <Link
          href="/pacotes"
          className="mt-12 inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
        >
          Ver todos os pacotes <ArrowRight className="h-4 w-4" />
        </Link>
      </Container>
    </Section>
  );
}
