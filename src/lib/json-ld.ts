import type { PropertyConfig } from "@/config/properties";
import { PROPERTIES, SOLARIUM_COMPLETO_GALLERY_GROUPS } from "@/config/properties";
import { AIRBNB_LINKS, HERO_IMAGE, SITE } from "@/config/site";
import { SITE_URL, NOME_SITE } from "@/lib/seo";

/**
 * Dados estruturados (schema.org) do site. Funções puras: a página só chama e
 * entrega ao `<JsonLd>`. Sem `aggregateRating` nem `review` de propósito —
 * avaliação publicada pelo próprio negócio não gera estrela e arrisca ação
 * manual do Google.
 */

export type JsonLdObjeto = Record<string, unknown>;

/** @id estável do negócio, referenciado pelas casas (`containedInPlace`). */
export const ID_NEGOCIO = `${SITE_URL}/#negocio`;

export const idCasa = (slug: string) => `${SITE_URL}/${slug}#casa`;

export const ENDERECO = {
  "@type": "PostalAddress",
  streetAddress: "Bairro Jardim",
  addressLocality: "Itanhandu",
  addressRegion: "MG",
  postalCode: "37464-000",
  addressCountry: "BR",
} as const;

/** Arredondado para 2 casas (~1 km): o ponto exato só vai depois da reserva. */
export const COORDENADAS = { latitude: -22.29, longitude: -44.94 } as const;

const INSTAGRAM = `https://www.instagram.com/${SITE.instagram}`;

/** Horários do FAQ ("Como funciona o check-in?"). */
const CHECKIN = "15:00";
const CHECKOUT = "11:00";

function absoluta(src: string): string {
  return src.startsWith("http") ? src : `${SITE_URL}${src}`;
}

function comodidade(name: string) {
  return { "@type": "LocationFeatureSpecification", name, value: true };
}

function semRepetir<T>(lista: T[]): T[] {
  return Array.from(new Set(lista));
}

export function jsonLdNegocio(): JsonLdObjeto {
  const imagens = [
    HERO_IMAGE,
    PROPERTIES.find((p) => p.slug === "solarium-1")!.galleryImages[0],
    PROPERTIES.find((p) => p.slug === "solarium-2")!.galleryImages[0],
  ].map(absoluta);

  return {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    "@id": ID_NEGOCIO,
    name: NOME_SITE,
    url: SITE_URL,
    telephone: SITE.whatsappDisplay,
    image: imagens,
    priceRange: "R$ 1.150+",
    address: ENDERECO,
    geo: { "@type": "GeoCoordinates", ...COORDENADAS },
    petsAllowed: true,
    checkinTime: CHECKIN,
    checkoutTime: CHECKOUT,
    amenityFeature: ["SPA aquecido", "Piso aquecido", "Cinema privativo", "Wi-Fi"].map(comodidade),
    sameAs: [
      INSTAGRAM,
      AIRBNB_LINKS["solarium-1"],
      AIRBNB_LINKS["solarium-2"],
      AIRBNB_LINKS["solarium-completo"],
    ],
    containsPlace: PROPERTIES.map((p) => ({
      "@type": "VacationRental",
      "@id": idCasa(p.slug),
      name: p.name,
      url: `${SITE_URL}/${p.slug}`,
    })),
  };
}

/** Fotos da casa, sem repetir. O Completo soma a própria galeria às das duas casas. */
function imagensDaCasa(casa: PropertyConfig): string[] {
  const extras =
    casa.slug === "solarium-completo" ? SOLARIUM_COMPLETO_GALLERY_GROUPS.flatMap((g) => g.images) : [];
  return semRepetir([casa.heroImage, ...casa.galleryImages, ...extras]).map(absoluta);
}

/** Comodidades do config (curadas), não da API do Hostaway. O Completo herda as duas casas. */
function comodidadesDaCasa(casa: PropertyConfig): string[] {
  if (casa.slug !== "solarium-completo") return semRepetir(casa.amenitiesFallback);
  return semRepetir(
    PROPERTIES.filter((p) => p.slug !== "solarium-completo").flatMap((p) => p.amenitiesFallback),
  );
}

/**
 * Página de casa. `VacationRental` com a acomodação em `containsPlace`, como
 * pede o guia do Google para aluguel por temporada: ocupação, quartos e
 * comodidades são propriedades de `Accommodation`, não do negócio.
 *
 * `quartos` vem do Hostaway (`bedroomsNumber`); sem ele o campo é omitido,
 * nunca inventado.
 */
export function jsonLdCasa(casa: PropertyConfig, quartos?: number | null): JsonLdObjeto {
  const url = `${SITE_URL}/${casa.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "VacationRental",
    "@id": idCasa(casa.slug),
    identifier: String(casa.id),
    name: casa.name,
    url,
    description: casa.description,
    image: imagensDaCasa(casa),
    address: ENDERECO,
    ...COORDENADAS,
    checkinTime: CHECKIN,
    checkoutTime: CHECKOUT,
    containedInPlace: { "@id": ID_NEGOCIO },
    containsPlace: {
      "@type": "Accommodation",
      additionalType: "EntirePlace",
      occupancy: { "@type": "QuantitativeValue", maxValue: casa.capacity.max },
      ...(typeof quartos === "number" && quartos > 0 ? { numberOfBedrooms: quartos } : {}),
      petsAllowed: true,
      amenityFeature: comodidadesDaCasa(casa).map(comodidade),
    },
  };
}

export type Migalha = { nome: string; caminho: string };

export function jsonLdBreadcrumb(migalhas: Migalha[]): JsonLdObjeto {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: migalhas.map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: m.nome,
      item: m.caminho === "/" ? SITE_URL : `${SITE_URL}${m.caminho}`,
    })),
  };
}

export const MIGALHA_INICIO: Migalha = { nome: "Início", caminho: "/" };
export const MIGALHA_PACOTES: Migalha = { nome: "Pacotes", caminho: "/pacotes" };

/** JSON seguro dentro de `<script>`: `<` escapado impede fechar a tag. */
export function serializarJsonLd(dados: JsonLdObjeto): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}
