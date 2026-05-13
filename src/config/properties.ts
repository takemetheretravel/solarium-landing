export type PropertySlug = "solarium-1" | "solarium-2" | "solarium-completo";

export type Capacity = { ideal: number; max: number };

export type AmenityGroup = {
  groupId: "tecnologia" | "bem-estar" | "natureza" | "cozinha";
  title: string;
  iconName: "Cpu" | "Heart" | "Mountain" | "UtensilsCrossed";
  highlights: string[];
};

export type PropertyConfig = {
  id: number;
  slug: PropertySlug;
  name: string;
  shortName: string;
  capacity: Capacity;
  badge: string;
  tagline: string;
  description: string;
  differentials: string[];
  amenitiesFallback: string[];
  amenityGroups: AmenityGroup[];
  heroImage: string;
  cardImage: string;
  galleryImages: string[];
  videoPublicId?: string;
};

const TEC = (extras: string[] = []): AmenityGroup => ({
  groupId: "tecnologia",
  title: "Tecnologia & Conforto",
  iconName: "Cpu",
  highlights: ["Automação Alexa em todos os ambientes", "Piso aquecido", ...extras],
});

const BEM_ESTAR: AmenityGroup = {
  groupId: "bem-estar",
  title: "Bem-estar",
  iconName: "Heart",
  highlights: [
    "SPA com piscina infinita aquecida",
    "Banheira com vista para a serra",
    "Roupa de cama G3 Hotelaria",
  ],
};

const NATUREZA: AmenityGroup = {
  groupId: "natureza",
  title: "Conexão com a Natureza",
  iconName: "Mountain",
  highlights: [
    "Vista 360° para a Serra da Mantiqueira",
    "Pet friendly",
    "Fire pit ao ar livre",
  ],
};

const COZINHA = (churrasqueira: string): AmenityGroup => ({
  groupId: "cozinha",
  title: "Cozinha & Convivência",
  iconName: "UtensilsCrossed",
  highlights: [
    "Cozinha completa equipada",
    churrasqueira,
    "Deck para café da manhã",
  ],
});

const SOLARIUM_1: PropertyConfig = {
  id: 316007,
  slug: "solarium-1",
  name: "Solarium 1",
  shortName: "Solarium 1",
  capacity: { ideal: 2, max: 4 },
  badge: "Hidro com Vista Panorâmica",
  tagline: "Onde tudo começou — íntimo, premium, com vista para a Serra Fina.",
  description:
    "Solarium 1 é onde tudo começou. Pensado para casais que buscam um refúgio íntimo, integra design contemporâneo, tecnologia e a vista impressionante da Serra da Mantiqueira. A banheira de hidromassagem com vista para a serra, a cozinha aberta para o Parque Nacional do Itatiaia e o piso aquecido em todos os ambientes garantem que cada momento da sua estadia seja excepcional.",
  differentials: [
    "SPA com Hidro e borda infinita para a vista",
    "Banheira com vista panorâmica para a Serra Fina",
    "Cozinha completa com vista para o Parque Nacional do Itatiaia",
    "Piso aquecido em todos os ambientes",
    "Automação por Alexa",
  ],
  amenitiesFallback: [
    "Wi-Fi de alta velocidade",
    "Piso aquecido",
    "Banheira de hidromassagem",
    "Piscina infinita aquecida",
    "Cozinha completa",
    "Lareira",
    "Smart TV",
    "Automação Alexa",
    "Estacionamento gratuito",
    "Roupa de cama e banho premium",
    "Churrasqueira a gás",
  ],
  amenityGroups: [TEC(["Smart TV e som integrado"]), BEM_ESTAR, NATUREZA, COZINHA("Churrasqueira a gás")],
  heroImage: "/images/solarium-1/01-banheira-por-do-sol.jpg",
  cardImage: "/images/solarium-1/01-banheira-por-do-sol.jpg",
  galleryImages: [
    "/images/solarium-1/01-banheira-por-do-sol.jpg",
    "/images/solarium-1/02-banheira-serra-fina.jpg",
    "/images/solarium-1/03-cafe-na-rede.jpg",
    "/images/solarium-1/04-vista-traseira.jpg",
    "/images/solarium-1/05-banheira.jpg",
    "/images/solarium-1/06-redario.jpg",
    "/images/solarium-1/07-nevoeiro-plantas.jpg",
    "/images/solarium-1/08-fire-pit.jpg",
    "/images/solarium-1/09-deck-por-do-sol.jpg",
    "/images/solarium-1/10-frente-rede-banheira.jpg",
  ],
};

const SOLARIUM_2: PropertyConfig = {
  id: 316005,
  slug: "solarium-2",
  name: "Solarium 2",
  shortName: "Solarium 2",
  capacity: { ideal: 2, max: 4 },
  badge: "Cinema Integrado",
  tagline: "Cinema, SPA com teto retrátil e película inteligente — pura imersão.",
  description:
    "Solarium 2 é a casa para quem busca uma experiência ainda mais imersiva. Cinema integrado com home theater, SPA com abertura de teto retrátil para banhos sob as estrelas, e película inteligente no chuveiro que troca de transparente para opaca ao toque. Cada detalhe foi pensado para que a vista da Serra da Mantiqueira seja parte da sua estadia, sem abrir mão de privacidade.",
  differentials: [
    "Cinema integrado com home theater",
    "SPA de imersão com borda infinita voltada para o cinema",
    "SPA com abertura de teto retrátil",
    "Película inteligente para o chuveiro",
    "Piso aquecido",
  ],
  amenitiesFallback: [
    "Wi-Fi de alta velocidade",
    "Piso aquecido",
    "Cinema com home theater",
    "SPA com teto retrátil",
    "Película inteligente para o chuveiro",
    "Banheira de hidromassagem",
    "Cozinha completa",
    "Smart TV",
    "Estacionamento gratuito",
    "Roupa de cama e banho premium",
    "Churrasqueira a gás e a carvão",
  ],
  amenityGroups: [
    TEC(["Película inteligente no chuveiro"]),
    BEM_ESTAR,
    NATUREZA,
    COZINHA("Churrasqueira a gás e a carvão"),
  ],
  heroImage: "/images/solarium-2/01-deck-serra-fina.jpg",
  cardImage: "/images/solarium-2/05-spa-teto-retratil.jpg",
  videoPublicId: "solarium/solarium-2-apresentacao",
  galleryImages: [
    "/images/solarium-2/01-deck-serra-fina.jpg",
    "/images/solarium-2/02-banheira-por-do-sol.jpg",
    "/images/solarium-2/03-frente-por-do-sol.jpg",
    "/images/solarium-2/04-cinema-por-do-sol.jpg",
    "/images/solarium-2/05-spa-teto-retratil.jpg",
    "/images/solarium-2/06-spa-teto-retratil-2.jpg",
    "/images/solarium-2/07-quarto-por-do-sol.jpg",
    "/images/solarium-2/08-cinema-deck.jpg",
    "/images/solarium-2/09-deck-tv.jpg",
    "/images/solarium-2/10-quarto-decorado.jpg",
  ],
};

const SOLARIUM_COMPLETO: PropertyConfig = {
  id: 316006,
  slug: "solarium-completo",
  name: "Solarium Completo",
  shortName: "Completo",
  capacity: { ideal: 4, max: 8 },
  badge: "Para Grupos e Celebrações",
  tagline: "As duas casas reservadas para você. Privacidade total.",
  description:
    "Solarium Completo é a reserva de ambas as casas para uma experiência exclusiva. Privacidade total da propriedade, ideal para celebrações, reuniões de família ou grupos pequenos que querem aproveitar o melhor das duas casas — do cinema integrado do Solarium 2 ao SPA com piscina infinita do Solarium 1, sem nenhum vizinho.",
  differentials: [
    "Reserva de ambas as casas",
    "Privacidade total da propriedade",
    "Ideal para celebrações e grupos pequenos",
    "Acesso completo às comodidades das duas casas",
  ],
  amenitiesFallback: [
    "Tudo do Solarium 1 e Solarium 2",
    "Privacidade total",
    "Capacidade para 8 hóspedes",
    "Cinema, SPA aquecido e duas banheiras de hidromassagem",
    "Estacionamento amplo",
    "Duas churrasqueiras (a gás e a carvão)",
  ],
  amenityGroups: [
    TEC(["Smart TV e som integrado", "Película inteligente no chuveiro (Solarium 2)"]),
    BEM_ESTAR,
    NATUREZA,
    COZINHA("Duas churrasqueiras (a gás e a carvão)"),
  ],
  heroImage: "/images/solarium-completo/01-frente-externa.jpg",
  cardImage: "/images/solarium-completo/01-frente-externa.jpg",
  galleryImages: [
    "/images/solarium-completo/01-frente-externa.jpg",
    "/images/solarium-completo/02-noite-com-lua.jpg",
    "/images/solarium-completo/03-final-de-tarde.jpg",
    "/images/solarium-completo/04-drone-serra-itatiaia.jpg",
    "/images/solarium-completo/05-drone-itatiaia.jpg",
    "/images/solarium-completo/06-drone-serra-papagaio.jpg",
  ],
};

export const PROPERTIES: PropertyConfig[] = [SOLARIUM_1, SOLARIUM_2, SOLARIUM_COMPLETO];

export function getPropertyBySlug(slug: string): PropertyConfig | undefined {
  return PROPERTIES.find((p) => p.slug === slug);
}

export function getPropertyById(id: number): PropertyConfig | undefined {
  return PROPERTIES.find((p) => p.id === id);
}

export const SOLARIUM_COMPLETO_GALLERY_GROUPS: { title: string; images: string[] }[] = [
  {
    title: "Solarium 1",
    images: [
      "/images/solarium-1/01-banheira-por-do-sol.jpg",
      "/images/solarium-1/02-banheira-serra-fina.jpg",
      "/images/solarium-1/04-vista-traseira.jpg",
      "/images/solarium-1/08-fire-pit.jpg",
    ],
  },
  {
    title: "Solarium 2",
    images: [
      "/images/solarium-2/01-deck-serra-fina.jpg",
      "/images/solarium-2/05-spa-teto-retratil.jpg",
      "/images/solarium-2/04-cinema-por-do-sol.jpg",
      "/images/solarium-2/08-cinema-deck.jpg",
    ],
  },
  {
    title: "Visões do conjunto",
    images: [
      "/images/solarium-completo/01-frente-externa.jpg",
      "/images/solarium-completo/02-noite-com-lua.jpg",
      "/images/solarium-completo/04-drone-serra-itatiaia.jpg",
      "/images/solarium-completo/05-drone-itatiaia.jpg",
    ],
  },
];
