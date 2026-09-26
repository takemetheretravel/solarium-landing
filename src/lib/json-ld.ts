import type { PropertyConfig } from "@/config/properties";
import { PROPERTIES } from "@/config/properties";
import { montarGaleriaDaCasa, podeSerVitrine, urlGaleria } from "@/lib/galerias";
import { AIRBNB_LINKS, HERO_IMAGE, SITE } from "@/config/site";
import { SITE_URL, NOME_SITE, SEO_PAGINAS } from "@/lib/seo";

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
    // Só referências: com @type/name o Google lê "VacationRental incompleto"
    // na home. Os dados completos estão em cada página de casa.
    containsPlace: PROPERTIES.map((p) => ({ "@id": idCasa(p.slug) })),
  };
}

/** Fotos por casa no JSON-LD: o Google pede no mínimo 8. */
export const MIN_IMAGENS_CASA = 8;
const MAX_IMAGENS_CASA = 20;

/**
 * Fotos da casa vindas do manifesto: a capa, depois as que podem ser vitrine
 * (sem marca d'água, tela ou baixa resolução — IMG-0), depois as demais que
 * aparecem no site. Nunca foto excluída. O Completo soma o conjunto às casas.
 */
function imagensDaCasa(casa: PropertyConfig): string[] {
  const { hero, todas } = montarGaleriaDaCasa(casa.slug);
  const ordem = [hero, ...todas.filter(podeSerVitrine), ...todas].map((i) => i.arquivo);
  return semRepetir(ordem).slice(0, MAX_IMAGENS_CASA).map(urlGaleria);
}

/**
 * Estrutura de cada casa. **O site não mostra esses números**: são os valores
 * mais prováveis pelas fotos e pastas do Drive (Solarium 1 tem banheiro da
 * suíte e social; o Solarium 2, um banheiro) e pela capacidade (até 4 = cama de
 * casal + sofá-cama). Aguardam confirmação do Lucas (DECISOES, IMG-1a-ajustes).
 * O Completo é a soma das duas casas.
 */
type Estrutura = { quartos: number; banheiros: number; camas: { numero: number; tipo: string }[] };

const S1: Estrutura = {
  quartos: 1,
  banheiros: 2,
  camas: [{ numero: 1, tipo: "Cama de casal" }, { numero: 1, tipo: "Sofá-cama" }],
};
const S2: Estrutura = {
  quartos: 1,
  banheiros: 1,
  camas: [{ numero: 1, tipo: "Cama de casal" }, { numero: 1, tipo: "Sofá-cama" }],
};

export const ESTRUTURA: Record<string, Estrutura> = {
  "solarium-1": S1,
  "solarium-2": S2,
  "solarium-completo": {
    quartos: S1.quartos + S2.quartos,
    banheiros: S1.banheiros + S2.banheiros,
    camas: [{ numero: 2, tipo: "Cama de casal" }, { numero: 2, tipo: "Sofá-cama" }],
  },
};

/** Comodidades do config (curadas), não da API do Hostaway. O Completo herda as duas casas. */
function comodidadesDaCasa(casa: PropertyConfig): string[] {
  if (casa.slug !== "solarium-completo") return semRepetir(casa.amenitiesFallback);
  return semRepetir(
    PROPERTIES.filter((p) => p.slug !== "solarium-completo").flatMap((p) => p.amenitiesFallback),
  );
}

/**
 * Página de casa. `VacationRental` com a acomodação em `containsPlace`, como
 * pede o guia do Google para aluguel por temporada. `identifier` é o id do
 * listing no Hostaway. `geo` e também `latitude`/`longitude` no topo: o guia
 * de VacationRental exige os dois últimos.
 */
export function jsonLdCasa(casa: PropertyConfig): JsonLdObjeto {
  const url = `${SITE_URL}/${casa.slug}`;
  const est = ESTRUTURA[casa.slug];
  const descricao = SEO_PAGINAS[`/${casa.slug}` as keyof typeof SEO_PAGINAS]?.description ?? casa.tagline;
  return {
    "@context": "https://schema.org",
    "@type": "VacationRental",
    "@id": idCasa(casa.slug),
    additionalType: "House",
    identifier: String(casa.id),
    name: casa.name,
    url,
    description: descricao,
    image: imagensDaCasa(casa),
    address: ENDERECO,
    geo: { "@type": "GeoCoordinates", ...COORDENADAS },
    ...COORDENADAS,
    checkinTime: CHECKIN,
    checkoutTime: CHECKOUT,
    containedInPlace: { "@id": ID_NEGOCIO },
    containsPlace: {
      "@type": "Accommodation",
      additionalType: "EntirePlace",
      occupancy: { "@type": "QuantitativeValue", value: casa.capacity.max },
      numberOfBedrooms: est.quartos,
      numberOfBathroomsTotal: est.banheiros,
      bed: est.camas.map((c) => ({ "@type": "BedDetails", numberOfBeds: c.numero, typeOfBed: c.tipo })),
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
