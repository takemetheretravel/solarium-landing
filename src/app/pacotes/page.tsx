import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import { formatBRL, formatExtraPrice } from "@/lib/cn";
import { pacotesV2Ativo } from "@/config/flags";
import {
  PACOTES_V2,
  EXTRAS,
  ROTULO_UNIDADE,
  JANELA_CANCELAMENTO_EXTRAS_DIAS,
  precoExtra,
  getExtra,
  pacoteVisivelHoje,
} from "@/config/precos-e-extras";
import { diariaMinima } from "@/lib/pricing/pacote-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pacotes — Solarium Mantiqueira",
  description: "Estadias com itens já organizados, em uma reserva só.",
};

export default async function PaginaPacotes() {
  if (!pacotesV2Ativo()) notFound();

  const hoje = new Date().toISOString().slice(0, 10);
  const visiveis = PACOTES_V2.filter((p) => p.ativo && pacoteVisivelHoje(p, hoje));

  const cards = await Promise.all(
    visiveis
      .sort((a, b) => a.prioridadeHome - b.prioridadeHome)
      .map(async (p) => ({
        pacote: p,
        minima: await diariaMinima(p.properties[0]),
      })),
  );

  return (
    <main>
      <Section>
        <Container>
          <Kicker className="mb-4">Pacotes</Kicker>
          <Heading level={1}>Estadias com tudo já organizado.</Heading>
          <p className="mt-6 max-w-2xl font-sans text-base leading-relaxed text-charcoal/70">
            Cada pacote reúne as noites e os itens que a maioria dos hóspedes acaba pedindo, com uma
            condição melhor do que contratar cada coisa à parte.
          </p>

          {/* Grade */}
          <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ pacote, minima }) => {
              const itens = pacote.inclusos
                .map((i) => getExtra(i.extraId))
                .filter((e): e is NonNullable<typeof e> => Boolean(e));

              return (
                <article
                  key={pacote.id}
                  className="flex flex-col border border-charcoal/10 bg-cream p-6"
                >
                  <Kicker className="mb-3">
                    {pacote.noitesMax === pacote.noitesMin
                      ? `${pacote.noitesMin} noites`
                      : `A partir de ${pacote.noitesMin} noites`}
                  </Kicker>
                  <Heading level={3} className="text-2xl text-charcoal">
                    {pacote.nome}
                  </Heading>
                  <p className="mt-3 flex-1 font-sans text-sm leading-relaxed text-charcoal/70">
                    {pacote.descricao}
                  </p>

                  <ul className="mt-5 space-y-1">
                    {itens.map((e) => (
                      <li key={e.id} className="font-sans text-xs text-charcoal/60">
                        {e.nome}
                      </li>
                    ))}
                  </ul>

                  {minima !== null && (
                    <p className="mt-5 font-serif text-lg text-charcoal">
                      A partir de {formatBRL(minima * pacote.noitesMin)}
                    </p>
                  )}

                  <Link
                    href={`/pacotes/${pacote.slug}`}
                    className="mt-5 inline-block font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
                  >
                    Ver pacote
                  </Link>
                </article>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Extras disponíveis — informativo, sem seleção */}
      <Section className="border-t border-charcoal/10 bg-cream">
        <Container size="narrow">
          <Kicker className="mb-4">Extras disponíveis</Kicker>
          <Heading level={2}>O que dá para acrescentar.</Heading>
          <ul className="mt-8 divide-y divide-charcoal/5">
            {EXTRAS.filter((e) => !e.informativo).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-4 py-3">
                <span className="font-sans text-sm text-charcoal">{e.nome}</span>
                <span className="shrink-0 font-sans text-xs text-charcoal/50">
                  {typeof e.preco === "number"
                    ? `${formatExtraPrice(precoExtra(e))} · ${ROTULO_UNIDADE[e.unidade]}`
                    : ROTULO_UNIDADE[e.unidade]}
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-charcoal/10">
        <Container size="narrow">
          <Kicker className="mb-4">Dúvidas frequentes</Kicker>
          <Heading level={2}>Antes de reservar um pacote.</Heading>
          <dl className="mt-8 space-y-8">
            {FAQ_PACOTES.map(({ p, r }) => (
              <div key={p}>
                <dt className="font-serif text-lg text-charcoal">{p}</dt>
                <dd className="mt-2 font-sans text-sm leading-relaxed text-charcoal/70">{r}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>
    </main>
  );
}

const FAQ_PACOTES = [
  {
    p: "Posso usar cupom em um pacote?",
    r: "Não. O preço do pacote já é a melhor condição disponível para aquelas datas, e não se soma a cupons.",
  },
  {
    p: "Dá para tirar algum item do pacote?",
    r: "O café da manhã pode sair, e o valor cai junto. O check-out estendido é o que define o pacote e sustenta a condição, então fica — a única saída é no Dois Casais, Uma Vista, onde ele pode ser removido.",
  },
  {
    p: "Com quanto tempo preciso pedir os extras?",
    r: "A decoração precisa de 5 dias. Cestas e massagem são combinadas com o concierge assim que a reserva é confirmada.",
  },
  {
    p: "Consigo cancelar um extra?",
    r: `Sim, com reembolso integral, desde que o pedido chegue com ${JANELA_CANCELAMENTO_EXTRAS_DIAS} dias ou mais de antecedência da sua chegada. A data-limite vai escrita no e-mail de confirmação. Dentro desse prazo, o extra não é reembolsado. O cancelamento da estadia tem regra própria.`,
  },
];
