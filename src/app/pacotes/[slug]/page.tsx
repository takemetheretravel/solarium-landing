import { notFound } from "next/navigation";
import { Metadata } from "next";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import PackageBooking from "@/components/booking/PackageBooking";
import { PACKAGES } from "@/config/packages";
import { pacotesV2Ativo } from "@/config/flags";
import { vistaPacote, slugsDePacote, textoNoites } from "@/lib/pricing/vista-pacote";
import { JANELA_CANCELAMENTO_EXTRAS_DIAS } from "@/config/precos-e-extras";

export const revalidate = 300;

export function generateStaticParams() {
  // Sem a flag, só os antigos existem — o roteamento não muda.
  return PACKAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const vista = vistaPacote(params.slug, pacotesV2Ativo());
  if (!vista) return { title: "Não encontrado" };
  return {
    title: `${vista.nome} — Solarium Mantiqueira`,
    description: vista.descricao.slice(0, 160),
    openGraph: {
      title: `${vista.nome} — Solarium Mantiqueira`,
      description: vista.descricao.slice(0, 160),
      images: [{ url: vista.imagem, width: 1200, height: 900, alt: vista.nome }],
    },
  };
}

type Busca = { checkin?: string; checkout?: string; casa?: string; guests?: string };

/** Aceita só o que é válido; parâmetro inválido é ignorado, nunca quebra a página. */
function lerLinkPersonalizado(sp: Busca): {
  checkin?: string;
  checkout?: string;
  casa?: string;
  guests?: number;
} {
  const dataOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const n = Number(sp.guests);
  return {
    checkin: dataOk(sp.checkin),
    checkout: dataOk(sp.checkout),
    casa: sp.casa?.trim() || undefined,
    guests: Number.isFinite(n) && n > 0 ? n : undefined,
  };
}

export default function PackagePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Busca;
}) {
  const v2Ativo = pacotesV2Ativo();
  const vista = vistaPacote(params.slug, v2Ativo);
  if (!vista) notFound();
  if (!slugsDePacote(v2Ativo).includes(vista.slug)) notFound();

  return (
    <main>
      {/* HERO */}
      <section className="relative h-[70vh] min-h-[480px] w-full overflow-hidden">
        <SmartImage src={vista.imagem} alt={vista.nome} priority sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 via-transparent to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-start justify-end px-6 pb-20 text-cream sm:px-16 sm:pb-24">
          <Kicker tone="cream" className="mb-4 opacity-90">
            Pacote · {textoNoites(vista)}
          </Kicker>
          <Heading level={1} className="text-cream">
            {vista.nome}
          </Heading>
          <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/85 sm:text-lg">
            {vista.tagline}
          </p>
        </div>
      </section>

      <Container size="wide">
        <div className="grid grid-cols-1 gap-12 py-16 lg:grid-cols-[1fr_440px] lg:gap-16 md:py-24">
          <div className="min-w-0">
            {/* DESCRIÇÃO */}
            <Kicker className="mb-4">A experiência</Kicker>
            <Heading level={2} className="text-3xl md:text-4xl">
              {vista.nome}.
            </Heading>
            <p className="mt-6 font-sans text-base leading-[1.8] text-charcoal/80">
              {vista.descricao}
            </p>

            {/* O QUE ESTÁ INCLUÍDO */}
            <div className="mt-12 border-t border-charcoal/10 pt-10">
              <Kicker className="mb-5">O que está incluído</Kicker>
              <ul className="space-y-4">
                {vista.inclusos.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-serra" />
                    <span className="font-sans text-base leading-relaxed text-charcoal/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {vista.aviso && (
              <p className="mt-10 border-l-2 border-copper/40 pl-4 font-sans text-sm leading-relaxed text-charcoal/60">
                {vista.aviso}
              </p>
            )}

            {/* CONDIÇÕES — só no motor novo, onde a política de extras existe */}
            {vista.pacoteV2 && (
              <div className="mt-12 border-t border-charcoal/10 pt-10">
                <Kicker className="mb-5">Condições</Kicker>
                <ul className="space-y-3 font-sans text-sm leading-relaxed text-charcoal/70">
                  <li>
                    Cancelamento da estadia: sem custo em até 7 dias após a confirmação, desde que
                    reste ao menos 24h antes do check-in.
                  </li>
                  <li>
                    Extras: reembolso integral quando cancelados com{" "}
                    {JANELA_CANCELAMENTO_EXTRAS_DIAS} dias ou mais de antecedência da sua chegada. A
                    data-limite vai escrita na confirmação.
                  </li>
                  <li>A decoração especial precisa de 5 dias de antecedência.</li>
                  <li>
                    O preço do pacote já é a melhor condição para estas datas, e não se soma a
                    cupons.
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* BOOKING — sticky no desktop */}
          <aside>
            <div className="lg:sticky lg:top-24">
              <PackageBooking
                pkg={vista.legado}
                pacoteV2={vista.pacoteV2}
                iniciais={lerLinkPersonalizado(searchParams)}
              />
            </div>
          </aside>
        </div>
      </Container>
    </main>
  );
}
