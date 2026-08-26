import Link from "next/link";
import { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Container from "@/components/ui/Container";
import Heading from "@/components/ui/Heading";
import Kicker from "@/components/ui/Kicker";
import SmartImage from "@/components/ui/SmartImage";
import BookingPageClient from "@/components/booking/BookingPageClient";
import PacotesCompativeis from "@/components/pacotes/PacotesCompativeis";
import { PROPERTIES, getPropertyBySlug } from "@/config/properties";
import { getPackageBySlug, validatePackageDates, round10down, isExtraActive } from "@/config/packages";
import { SERVICE_EXTRAS, CAFE_EXTRA_IDS, MAX_QTY_PER_EXTRA } from "@/config/service-extras";
import { OP_EXTRA_TYPES } from "@/config/operational-extras";
import { pacotesV2Ativo } from "@/config/flags";
import { extrasServicoV2, inclusosAtivos } from "@/lib/pricing/extras";
import { getPacoteV2 } from "@/config/precos-e-extras";
import { calcularPacoteServer } from "@/lib/pricing/pacote-server";
import { calculatePrice } from "@/lib/hostaway";
import { formatBRLPrecise } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Reserva — Seus dados",
  description: "Preencha seus dados para finalizar sua reserva no Solarium Mantiqueira.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Search = {
  propertyId?: string;
  checkin?: string;
  checkout?: string;
  guests?: string;
  payment?: string;
  coupon?: string;
  package?: string;
  pacote?: string;  // Pacotes V2: id do pacote no catálogo novo
  choices?: string;
  pkgExtras?: string; // extras ativos do pacote (labels "|") — removíveis omitidos saem
  removidos?: string; // Pacotes V2: ids de inclusos removidos, separados por ","
  extras?: string;    // extras de serviço (ids "," com qty opcional "id:qty") + tipos operacionais (early_checkin, late_checkout)
};

function isComplete(s: Search): s is Required<Pick<Search, "propertyId" | "checkin" | "checkout">> & Search {
  return Boolean(s.propertyId && s.checkin && s.checkout);
}

/** Nenhuma das três casas tem preço para as datas: todas ocupadas. */
function nenhumaCasaLivre(prices: Record<string, number | null>): boolean {
  const valores = Object.values(prices);
  return valores.length > 0 && valores.every((v) => v == null);
}

export default async function ReservarPage({ searchParams }: { searchParams: Search }) {
  if (!isComplete(searchParams)) {
    const checkin = searchParams.checkin;
    const checkout = searchParams.checkout;
    const guests = Number(searchParams.guests || 2);

    let prices: Record<string, number | null> = {};
    if (checkin && checkout) {
      const results = await Promise.all(
        PROPERTIES.map(async (p) => {
          const q = await calculatePrice(p.id, checkin, checkout, guests);
          return { slug: p.slug, total: q?.totalPrice ?? null };
        })
      );
      results.forEach((r) => { prices[r.slug] = r.total; });
    }

    return (
      <ChooseProperty
        checkin={checkin}
        checkout={checkout}
        guests={guests}
        prices={prices}
        pacotes={
          checkin && checkout ? (
            <PacotesCompativeis
              checkin={checkin}
              checkout={checkout}
              guests={guests}
              variante={nenhumaCasaLivre(prices) ? "acima" : "abaixo"}
            />
          ) : null
        }
        pacotesAcima={nenhumaCasaLivre(prices)}
      />
    );
  }

  // Link antigo com `?package=` para um pacote que migrou para o motor V2: vale
  // como `?pacote=`. Sem isto, um link já enviado pelo atendimento passaria a
  // abrir o checkout sem o pacote — a preço cheio, em silêncio.
  if (searchParams.package && !searchParams.pacote && getPacoteV2(searchParams.package)) {
    searchParams.pacote = searchParams.package;
    searchParams.package = undefined;
  }

  const property = getPropertyBySlug(searchParams.propertyId);
  if (!property) return <ChooseProperty />;
  const checkin = searchParams.checkin!;
  const checkout = searchParams.checkout!;
  const guests = Number(searchParams.guests || 2);
  const paymentMethod: "card" | "pix" = searchParams.payment === "pix" ? "pix" : "card";
  const couponCode = (searchParams.coupon || "").trim().toUpperCase();

  const quote = await calculatePrice(property.id, checkin, checkout, guests);
  if (!quote) console.error("[reservar] calculatePrice returned null for", property.id, checkin, checkout, guests);

  // Pacote: recalcula o total com desconto de estadia + extras (validado de novo no draft)
  const pkg = searchParams.package ? getPackageBySlug(searchParams.package) : undefined;
  let packageInfo: {
    slug: string;
    name: string;
    stayTotal: number;
    extras: { label: string; amount: number }[];
    total: number;
    aLaCarte: number;
  } | null = null;
  if (
    pkg &&
    quote &&
    pkg.properties.includes(property.slug) &&
    validatePackageDates(pkg, checkin, checkout).valid
  ) {
    const stayTotal = round10down(quote.totalPrice * (1 - pkg.stayDiscountPct / 100));
    const chosenLabels = (searchParams.choices || "").split("|").filter(Boolean);
    const activeLabels = searchParams.pkgExtras
      ? searchParams.pkgExtras.split("|").filter(Boolean)
      : null;
    const extras = pkg.extras
      .filter((e) => isExtraActive(e, activeLabels))
      .map((e) => {
        if (e.choices?.length) {
          const chosen =
            e.choices.find((c) => chosenLabels.includes(c.label))?.label ?? e.choices[0].label;
          return { label: `${e.label}: ${chosen}`, amount: e.price };
        }
        return {
          label: e.perNight ? `${e.label} ×${pkg.nights}` : e.label,
          amount: e.price * (e.perNight ? pkg.nights : 1),
        };
      });
    const extrasSum = extras.reduce((s, e) => s + e.amount, 0);
    packageInfo = {
      slug: pkg.slug,
      name: pkg.name,
      stayTotal,
      extras,
      total: stayTotal + extrasSum,
      aLaCarte: quote.totalPrice + extrasSum,
    };
  }

  // Extras de serviço (massagem, cestas) — marcáveis por quantidade no checkout, sem bloqueio.
  // Se o pacote já inclui café, escondemos as cestas (só a massagem aparece).
  // Link pré-marca quantidades: extras=massagem:2,cafe_diluia:1 (id:qty; qty omitida = 1).
  const packageHasCafe = Boolean(
    pkg && pkg.extras.some((e) => /café da manhã|cesta de café/i.test(e.label)),
  );
  const opTypeSet = new Set<string>(OP_EXTRA_TYPES);
  const preselectedQty: Record<string, number> = {};
  const preselectedOp: string[] = [];
  (searchParams.extras || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((token) => {
      const [rawId, rawQty] = token.split(":");
      const id = (rawId || "").trim();
      if (!id) return;
      if (opTypeSet.has(id)) {
        if (!preselectedOp.includes(id)) preselectedOp.push(id);
        return;
      }
      const qty = rawQty ? Math.floor(Number(rawQty)) || 0 : 1;
      const clamped = Math.min(Math.max(0, qty), MAX_QTY_PER_EXTRA);
      if (clamped > 0) preselectedQty[id] = clamped;
    });
  // Com Pacotes V2 o catálogo do checkout é o mesmo da página da casa — os 12
  // itens, menos informativos e operacionais. Sem a flag, nada muda.
  const catalogo = pacotesV2Ativo()
    ? extrasServicoV2()
    : SERVICE_EXTRAS.map((e) => ({
        id: e.id,
        label: e.label,
        unitPrice: e.price,
        restriction: e.restriction,
      }));

  // O que o pacote já entrega não pode ser oferecido de novo — seria cobrar duas
  // vezes pelo mesmo serviço. Vale para TODOS os inclusos, não só o late.
  const pacoteV2Cru =
    pacotesV2Ativo() && searchParams.pacote ? getPacoteV2(searchParams.pacote) : undefined;
  const removidosCru = (searchParams.removidos || "").split(",").filter(Boolean);
  const jaInclusos = new Set(inclusosAtivos(pacoteV2Cru, removidosCru));

  const serviceExtras = catalogo
    .filter((e) => !(packageHasCafe && CAFE_EXTRA_IDS.includes(e.id)))
    .filter((e) => !jaInclusos.has(e.id))
    .map((e) => ({ ...e, qty: preselectedQty[e.id] ?? 0 }));

  // PACOTES V2 — motor novo, autoritativo. O total exibido aqui é exatamente o
  // que o draft recalcula; nada de preço vindo da URL.
  const pacoteV2 = pacoteV2Cru;
  const removidosV2 = removidosCru;
  let pacoteV2Info: typeof packageInfo = null;

  if (pacoteV2) {
    const calc = await calcularPacoteServer({
      pacote: pacoteV2,
      propertySlug: property.slug,
      propertyId: property.id,
      checkin,
      checkout,
      guests,
      removidos: removidosV2,
      selecao: preselectedQty,
    });
    if (calc.ok) {
      pacoteV2Info = {
        slug: pacoteV2.slug,
        name: pacoteV2.nome,
        stayTotal: calc.resultado.hostawayTotal,
        extras: calc.resultado.itens.map((i) => ({
          label: i.qtd > 1 ? `${i.nome} ×${i.qtd}` : i.nome,
          amount: i.total,
        })),
        total: calc.resultado.total,
        aLaCarte: calc.resultado.subtotal,
      };
    }
  }

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container size="wide">
        <Link
          href={`/${property.slug}`}
          className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.25em] text-charcoal/60 hover:text-copper"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para {property.name}
        </Link>

        <div className="mt-8">
          <Kicker className="mb-4">Reserva — etapa 1 de 2</Kicker>
          <Heading level={1} className="text-4xl sm:text-5xl">
            Seus dados
          </Heading>
          <p className="mt-3 max-w-2xl font-sans text-base text-charcoal/70">
            Preencha as informações abaixo e siga para o pagamento. Levamos a sério a privacidade — seus dados são tratados conforme a{" "}
            <Link href="/privacidade" className="text-copper underline underline-offset-4">LGPD</Link>.
          </p>
        </div>

        <BookingPageClient
          property={{
            slug: property.slug,
            name: property.name,
            badge: property.badge,
            heroImage: property.heroImage,
          }}
          checkin={checkin}
          checkout={checkout}
          guests={guests}
          initialPaymentMethod={paymentMethod}
          initialCouponCode={packageInfo ? undefined : couponCode || undefined}
          quote={
            pacoteV2Info
              ? { totalPrice: pacoteV2Info.total, nights: quote!.nights }
              : packageInfo
              ? { totalPrice: packageInfo.total, nights: quote!.nights }
              : quote
                ? { totalPrice: quote.totalPrice, nights: quote.nights }
                : null
          }
          packageInfo={pacoteV2Info ?? packageInfo}
          pacoteId={pacoteV2Info && pacoteV2 ? pacoteV2.id : undefined}
          removidos={pacoteV2Info ? removidosV2 : undefined}
          selecaoExtrasPacote={pacoteV2Info ? preselectedQty : undefined}
          packageChoices={packageInfo ? searchParams.choices : undefined}
          packageExtrasActive={packageInfo ? searchParams.pkgExtras : undefined}
          serviceExtras={serviceExtras}
          opExtrasPreselected={preselectedOp.filter((t) => !jaInclusos.has(t))}
          inclusosPacote={Array.from(jaInclusos)}
        />
      </Container>
    </main>
  );
}

function ChooseProperty({
  checkin,
  checkout,
  guests,
  prices,
  pacotes,
  pacotesAcima,
}: {
  checkin?: string;
  checkout?: string;
  guests?: number;
  prices?: Record<string, number | null>;
  /** Bloco de pacotes compatíveis. */
  pacotes?: React.ReactNode;
  /**
   * Sobe o bloco para cima dos cards quando nenhuma casa está livre: três
   * "indisponível" e mais nada é a pior tela do site.
   */
  pacotesAcima?: boolean;
}) {
  const hasDates = Boolean(checkin && checkout);

  function fmtDate(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  return (
    <main className="bg-cream pt-32 pb-20">
      <Container>
        <Kicker className="mb-4">Reserva</Kicker>
        <Heading level={1} className="text-4xl sm:text-5xl">
          Escolha a casa para reservar.
        </Heading>
        {hasDates ? (
          <p className="mt-4 max-w-2xl font-sans text-base text-charcoal/70">
            {guests} hóspede{guests !== 1 ? "s" : ""} · {fmtDate(checkin!)} → {fmtDate(checkout!)}
          </p>
        ) : (
          <p className="mt-4 max-w-2xl font-sans text-base text-charcoal/70">
            Selecione a casa, datas e hóspedes para iniciar a reserva.
          </p>
        )}
        {pacotesAcima ? <div className="mt-12">{pacotes}</div> : null}
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PROPERTIES.map((p) => {
            const total = prices?.[p.slug];
            const qs = new URLSearchParams();
            if (checkin) qs.set("checkin", checkin);
            if (checkout) qs.set("checkout", checkout);
            if (guests) qs.set("guests", String(guests));
            const query = qs.toString();
            const href = `/${p.slug}${query ? `?${query}` : ""}`;

            return (
              <Link
                key={p.slug}
                href={href}
                className="group flex flex-col bg-cream transition-all hover:-translate-y-1"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-charcoal/5">
                  <SmartImage src={p.cardImage} alt={p.name} sizes="(max-width: 1024px) 100vw, 33vw" />
                </div>
                <div className="border-t border-charcoal/10 p-6">
                  <Kicker className="mb-2">{p.badge}</Kicker>
                  <h2 className="font-serif text-2xl text-charcoal">{p.name}</h2>
                  <p className="mt-2 font-sans text-sm text-charcoal/60">
                    Ideal para {p.capacity.ideal} · acomoda até {p.capacity.max}
                  </p>
                  <p className="mt-3 font-serif text-xl text-charcoal">
                    {!hasDates ? (
                      <span>
                        <span className="font-sans text-xs uppercase tracking-widest text-charcoal/50">A partir de </span>
                        {formatBRLPrecise(p.fromPriceNightly)}
                        <span className="font-sans text-xs uppercase tracking-widest text-charcoal/50"> / noite</span>
                      </span>
                    ) : total != null ? (
                      formatBRLPrecise(total)
                    ) : (
                      <span className="font-sans text-sm text-charcoal/50">
                        Indisponível — consulte outras datas
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        {pacotesAcima ? null : pacotes}
      </Container>
    </main>
  );
}
