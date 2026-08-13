import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { formatBRL } from "@/lib/cn";
import { PACOTES_V2, getExtra, pacoteVisivelHoje } from "@/config/precos-e-extras";
import { getPackageBySlug } from "@/config/packages";
import { diariaMinima } from "@/lib/pricing/pacote-server";

/**
 * Bloco de pacotes da home. No máximo 3 cards.
 *
 * Prioridade: Fim de Semana Completo → Dois Casais, Uma Vista → Feriado na Serra
 * quando estiver na janela sazonal; fora dela, Meio de Semana na Serra.
 *
 * Sem datas escolhidas, mostra "a partir de" — mínimo dos próximos 90 dias por
 * listing, cacheado por 60 min. O recálculo com datas concretas acontece na
 * página do pacote, contra o servidor.
 */
export default async function PacotesHome() {
  const hoje = new Date().toISOString().slice(0, 10);

  const v2 = PACOTES_V2.filter((p) => p.ativo && pacoteVisivelHoje(p, hoje)).sort(
    (a, b) => a.prioridadeHome - b.prioridadeHome,
  );

  const cards = await Promise.all(
    v2.slice(0, 3).map(async (p) => ({
      slug: p.slug,
      nome: p.nome,
      descricao: p.descricao,
      noites:
        p.noitesMax === p.noitesMin ? `${p.noitesMin} noites` : `A partir de ${p.noitesMin} noites`,
      itens: p.inclusos
        .map((i) => getExtra(i.extraId)?.nome)
        .filter((n): n is string => Boolean(n)),
      minimo: (await diariaMinima(p.properties[0])) ?? null,
      noitesMin: p.noitesMin,
    })),
  );

  // Fora da janela de feriado sobra espaço: o Meio de Semana entra como terceiro.
  if (cards.length < 3) {
    const meio = getPackageBySlug("meio-de-semana");
    if (meio) {
      cards.push({
        slug: meio.slug,
        nome: meio.name,
        descricao: meio.tagline,
        noites: `${meio.nights} noites`,
        itens: meio.extras.map((e) => e.label),
        minimo: null,
        noitesMin: meio.nights,
      });
    }
  }

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

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <article key={c.slug} className="flex flex-col border border-charcoal/10 bg-white p-6">
              <Kicker className="mb-3">{c.noites}</Kicker>
              <Heading level={3} className="text-2xl text-charcoal">
                {c.nome}
              </Heading>
              <p className="mt-3 flex-1 font-sans text-sm leading-relaxed text-charcoal/70">
                {c.descricao}
              </p>
              <ul className="mt-5 space-y-1">
                {c.itens.map((i) => (
                  <li key={i} className="font-sans text-xs text-charcoal/60">
                    {i}
                  </li>
                ))}
              </ul>
              {c.minimo !== null && (
                <p className="mt-5 font-serif text-lg text-charcoal">
                  A partir de {formatBRL(c.minimo * c.noitesMin)}
                </p>
              )}
              <Link
                href={`/pacotes/${c.slug}`}
                className="mt-5 inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
              >
                Ver pacote <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </article>
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
