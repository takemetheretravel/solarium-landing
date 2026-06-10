import { notFound } from "next/navigation";
import { Metadata } from "next";
import { Check } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import PackageBooking from "@/components/booking/PackageBooking";
import { PACKAGES, getPackageBySlug } from "@/config/packages";

export const revalidate = 300;

export function generateStaticParams() {
  return PACKAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const pkg = getPackageBySlug(params.slug);
  if (!pkg) return { title: "Não encontrado" };
  return {
    title: `${pkg.name} — Solarium Mantiqueira`,
    description: pkg.description.slice(0, 160),
    openGraph: {
      title: `${pkg.name} — Solarium Mantiqueira`,
      description: pkg.description.slice(0, 160),
      images: [{ url: pkg.image, width: 1200, height: 900, alt: pkg.name }],
    },
  };
}

export default function PackagePage({ params }: { params: { slug: string } }) {
  const pkg = getPackageBySlug(params.slug);
  if (!pkg) notFound();

  return (
    <main>
      {/* HERO */}
      <section className="relative h-[70vh] min-h-[480px] w-full overflow-hidden">
        <SmartImage src={pkg.image} alt={pkg.name} priority sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal/30 via-transparent to-charcoal/70" />
        <div className="relative z-10 flex h-full flex-col items-start justify-end px-6 pb-20 text-cream sm:px-16 sm:pb-24">
          <Kicker tone="cream" className="mb-4 opacity-90">
            Pacote · {pkg.nights} noites
          </Kicker>
          <Heading level={1} className="text-cream">
            {pkg.name}
          </Heading>
          <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-cream/85 sm:text-lg">
            {pkg.tagline}
          </p>
        </div>
      </section>

      <Container size="wide">
        <div className="grid grid-cols-1 gap-12 py-16 lg:grid-cols-[1fr_440px] lg:gap-16 md:py-24">
          <div className="min-w-0">
            {/* DESCRIÇÃO */}
            <Kicker className="mb-4">A experiência</Kicker>
            <Heading level={2} className="text-3xl md:text-4xl">
              {pkg.name}.
            </Heading>
            <p className="mt-6 font-sans text-base leading-[1.8] text-charcoal/80">
              {pkg.description}
            </p>

            {/* O QUE ESTÁ INCLUÍDO */}
            <div className="mt-12 border-t border-charcoal/10 pt-10">
              <Kicker className="mb-5">O que está incluído</Kicker>
              <ul className="space-y-4">
                {pkg.included.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-serra" />
                    <span className="font-sans text-base leading-relaxed text-charcoal/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {pkg.weekdaysOnly && (
              <p className="mt-10 border-l-2 border-copper/40 pl-4 font-sans text-sm leading-relaxed text-charcoal/60">
                Este pacote é válido para noites de segunda a quinta, fora de feriados.
                Para finais de semana e datas de feriado, fale com nosso concierge.
              </p>
            )}
          </div>

          {/* BOOKING — sticky no desktop */}
          <aside>
            <div className="lg:sticky lg:top-24">
              <PackageBooking pkg={pkg} />
            </div>
          </aside>
        </div>
      </Container>
    </main>
  );
}
