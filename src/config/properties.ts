export type PropertySlug = "solarium-1" | "solarium-2" | "solarium-completo";

export type PropertyConfig = {
  id: number;
  slug: PropertySlug;
  name: string;
  shortName: string;
  capacity: number;
  badge: string;
  tagline: string;
  description: string;
  differentials: string[];
  amenitiesFallback: string[];
  heroImageId: string;
  galleryImageIds: string[];
};

const SOLARIUM_1: PropertyConfig = {
  id: 316007,
  slug: "solarium-1",
  name: "Solarium 1",
  shortName: "Solarium 1",
  capacity: 4,
  badge: "Para casais",
  tagline: "Onde tudo começou — íntimo, premium, com vista para a Serra Fina.",
  description:
    "Solarium 1 é onde tudo começou. Pensado para casais que buscam um refúgio íntimo, integra design contemporâneo, tecnologia e a vista impressionante da Serra da Mantiqueira. A banheira de hidromassagem com vista para a serra, a cozinha aberta para o Parque Nacional do Itatiaia e o piso aquecido em todos os ambientes garantem que cada momento da sua estadia seja excepcional.",
  differentials: [
    "SPA com piscina infinita aquecida",
    "Banheira com vista para a Serra Fina",
    "Cozinha completa com vista para o Parque Nacional do Itatiaia",
    "Piso aquecido",
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
  ],
  heroImageId: "1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8",
  galleryImageIds: [
    "1Eq2UTnGpyyXhx0KPsWzeKtGOvlkWK1-8",
    "17W5LZJ8eLAEba49ZsGe1SK1b2t13r6Dy",
    "1iCDdn8uREEmp5LHyMmhVqDgAkb-EtEao",
    "12T5h6YPz1FekcJ8DgxeoJRfVoLdsMCBk",
    "1Z4X1XXazEEfMAshKbcwnewTh4jqpL-JP",
    "1GFb37d9ZP4wvF31UbuTzZoaAzL1QtH0i",
    "1Dsan8yfE0CCrWd1H082S2SgRhG6HIfbO",
    "1TwiWHWy_c0JL78C-K2EE1q5_RfAyYTi0",
    "1GB-9iGmZ91eVpYyHorO1K6MSduJn9djN",
    "1pvoYkpXzp3Yi3Ll-E7nmp-1SOCFLjKMd",
  ],
};

const SOLARIUM_2: PropertyConfig = {
  id: 316005,
  slug: "solarium-2",
  name: "Solarium 2",
  shortName: "Solarium 2",
  capacity: 4,
  badge: "Cinema integrado",
  tagline: "Cinema, SPA com teto retrátil e película inteligente — pura imersão.",
  description:
    "Solarium 2 é a casa para quem busca uma experiência ainda mais imersiva. Cinema integrado com home theater, SPA com abertura de teto retrátil para banhos sob as estrelas, e película inteligente nas janelas que troca de transparente para opaca ao toque. Cada detalhe foi pensado para que a vista da Serra da Mantiqueira seja parte da sua estadia, sem abrir mão de privacidade.",
  differentials: [
    "Cinema integrado com home theater",
    "SPA com abertura de teto retrátil",
    "Película inteligente nas janelas",
    "Maior imersão visual com a serra",
    "Piso aquecido",
  ],
  amenitiesFallback: [
    "Wi-Fi de alta velocidade",
    "Piso aquecido",
    "Cinema com home theater",
    "SPA com teto retrátil",
    "Película inteligente",
    "Banheira de hidromassagem",
    "Cozinha completa",
    "Smart TV",
    "Estacionamento gratuito",
    "Roupa de cama e banho premium",
  ],
  heroImageId: "1XZiLJItP4aC4A6rHZvEjiSahvc3g-yN3",
  galleryImageIds: [
    "1XZiLJItP4aC4A6rHZvEjiSahvc3g-yN3",
    "191sIkH7sYeooyP-Gyi-9RETR6HVwAXfy",
    "1AqotYVMMzKIDHxdQ3Br-l_0M7NpECU3Y",
    "17D_HYSerOCXpPeA5Zj-MlYEV8e8UsjE2",
    "1vo02TebjcJMEemE-qeataUsP2Hb2syr_",
    "1HidRA1fmmMeHj8kGZFl9mLRq5i0MEFIp",
    "1YcFd3mmu5uoAt7iRuOTt4SU2HgiPgOMj",
    "1heOGdG2Wjnvo5xhEfqQH-p6RnHpUJ-JZ",
    "1mFvtNGtLA3pPq7dBijeK6H-F-x1IEGyo",
    "1AXEISGXaorcWNBcSV1VCnoRkLv1ooeaB",
  ],
};

const SOLARIUM_COMPLETO: PropertyConfig = {
  id: 316006,
  slug: "solarium-completo",
  name: "Solarium Completo",
  shortName: "Completo",
  capacity: 8,
  badge: "Grupos e celebrações",
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
  ],
  heroImageId: "1-Uu90NgdM46pp9wsQbHTXTG_x5gRawUX",
  galleryImageIds: [
    "1-Uu90NgdM46pp9wsQbHTXTG_x5gRawUX",
    "1d7joJITenVQK_yoIgeFAowU441VuU2nL",
    "1n55Z5DEk27v1lUVKIlnr8FxYuAPJNxUW",
    "1fRqaIpWbAf6BLmRRcryCR6QnEpJ4u54h",
    "1V4dG3DWLIOoCUfuNu13Iw23QE4Uu_ONM",
    "1wDkVd1AOfckbf5iKyXC2-hKnrmJG74Gq",
  ],
};

export const PROPERTIES: PropertyConfig[] = [SOLARIUM_1, SOLARIUM_2, SOLARIUM_COMPLETO];

export function getPropertyBySlug(slug: string): PropertyConfig | undefined {
  return PROPERTIES.find((p) => p.slug === slug);
}

export function getPropertyById(id: number): PropertyConfig | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
