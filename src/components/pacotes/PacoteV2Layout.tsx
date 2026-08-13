import Container from "@/components/ui/Container";
import Section from "@/components/ui/Section";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import PacoteClient from "@/components/pacotes/PacoteClient";
import type { PacoteV2 } from "@/config/precos-e-extras";
import type { OrigemPacote } from "@/lib/tracking";

/** Estrutura da §7.4, igual nos quatro pacotes. */
export default function PacoteV2Layout({
  pacote,
  origem = "direto",
}: {
  pacote: PacoteV2;
  origem?: OrigemPacote;
}) {
  const propertySlug = pacote.properties[0];

  return (
    <main>
      {pacote.imagem ? (
        <section className="relative h-[60vh] min-h-[380px] w-full overflow-hidden">
          <SmartImage src={pacote.imagem} alt={pacote.nome} priority sizes="100vw" />
          <div className="absolute inset-0 bg-gradient-to-b from-charcoal/20 via-transparent to-charcoal/70" />
        </section>
      ) : (
        <section className="flex h-[32vh] min-h-[200px] w-full items-center justify-center bg-serra/10">
          <p className="px-6 text-center font-sans text-xs uppercase tracking-[0.25em] text-charcoal/40">
            {pacote.imagemPlaceholder?.nota ?? "Imagem em produção"}
          </p>
        </section>
      )}

      <Section>
        <Container size="narrow">
          <Kicker className="mb-4">
            {pacote.noitesMax === pacote.noitesMin
              ? `${pacote.noitesMin} noites`
              : `A partir de ${pacote.noitesMin} noites`}
          </Kicker>
          <Heading level={1}>{pacote.nome}</Heading>
          <p className="mt-6 max-w-2xl font-sans text-base leading-relaxed text-charcoal/70">
            {pacote.descricao}
          </p>

          <div className="mt-12">
            <PacoteClient pacote={pacote} propertySlug={propertySlug} origem={origem} />
          </div>
        </Container>
      </Section>
    </main>
  );
}
