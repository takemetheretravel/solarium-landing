/**
 * Curadoria das fotos das casas — a ÚNICA fonte de verdade escrita à mão.
 *
 * O que mora aqui vira `context.alt` e `tags` no Cloudinary (via
 * `upload:casas`), e de lá o `galeria:sync` monta `content/galerias/*.json`.
 * Editar uma legenda aqui e rodar os dois comandos propaga para o site.
 *
 * Por que a curadoria não mora no JSON: o manifesto é GERADO. Se a legenda
 * vivesse nele, o primeiro `galeria:sync` depois de um upload novo a
 * sobrescreveria. No Cloudinary ela sobrevive ao ciclo inteiro.
 *
 * `estacao` é `indiferente` em quase tudo de propósito: marcar uma foto como
 * "seca" ou "verde" sem saber o mês em que foi tirada seria inventar metadado
 * para o filtro mentir depois. Só entra quando a própria imagem denuncia.
 */

/** @type {Record<string, { alt: string, ambiente: string, estacao?: string, destaque?: boolean }>} */
export const CURADORIA = {
  // ── Solarium 1 ───────────────────────────────────────────────────────────
  "solarium-1/01-banheira-por-do-sol": {
    alt: "Banheira de hidromassagem no deck do Solarium 1 ao pôr do sol, com a Serra da Mantiqueira ao fundo",
    ambiente: "spa",
    destaque: true,
  },
  "solarium-1/02-banheira-serra-fina": {
    alt: "Banheira do Solarium 1 voltada para a Serra Fina em dia claro",
    ambiente: "spa",
    destaque: true,
  },
  "solarium-1/03-cafe-na-rede": {
    alt: "Café da manhã servido na rede da varanda do Solarium 1, de frente para o vale",
    ambiente: "externa",
    destaque: true,
  },
  "solarium-1/04-vista-traseira": {
    alt: "Vista a partir dos fundos do Solarium 1 para as montanhas do Parque Nacional do Itatiaia",
    ambiente: "vista",
    destaque: true,
  },
  "solarium-1/05-banheira": {
    alt: "Banheira de hidromassagem do Solarium 1 vista de perto, com borda voltada para a serra",
    ambiente: "spa",
    destaque: true,
  },
  "solarium-1/06-redario": {
    alt: "Redário do Solarium 1 armado no deck externo",
    ambiente: "externa",
  },
  "solarium-1/07-nevoeiro-plantas": {
    alt: "Nevoeiro passando entre a vegetação no entorno do Solarium 1",
    ambiente: "externa",
    estacao: "verde",
  },
  "solarium-1/08-fire-pit": {
    alt: "Fire pit aceso na área externa do Solarium 1 ao anoitecer",
    ambiente: "externa",
  },
  "solarium-1/09-deck-por-do-sol": {
    alt: "Deck do Solarium 1 no fim da tarde, com o sol baixo sobre a serra",
    ambiente: "externa",
  },
  "solarium-1/10-frente-rede-banheira": {
    alt: "Fachada do Solarium 1 com a rede e a banheira de hidromassagem em primeiro plano",
    ambiente: "externa",
  },

  // ── Solarium 2 ───────────────────────────────────────────────────────────
  "solarium-2/01-deck-serra-fina": {
    alt: "Deck do Solarium 2 com vista aberta para a Serra Fina",
    ambiente: "vista",
    destaque: true,
  },
  "solarium-2/02-banheira-por-do-sol": {
    alt: "Banheira do Solarium 2 ao pôr do sol, de frente para o vale",
    ambiente: "spa",
    destaque: true,
  },
  "solarium-2/03-frente-por-do-sol": {
    alt: "Fachada do Solarium 2 iluminada pela luz do fim de tarde",
    ambiente: "externa",
    destaque: true,
  },
  "solarium-2/04-cinema-por-do-sol": {
    alt: "Sala de cinema integrada do Solarium 2 com o pôr do sol visível pela vidraça",
    ambiente: "cinema",
    destaque: true,
  },
  "solarium-2/05-spa-teto-retratil": {
    alt: "SPA de imersão do Solarium 2 com o teto retrátil aberto para o céu",
    ambiente: "spa",
    destaque: true,
  },
  "solarium-2/06-spa-teto-retratil-2": {
    alt: "Outro ângulo do SPA do Solarium 2 com o teto retrátil aberto",
    ambiente: "spa",
  },
  "solarium-2/07-quarto-por-do-sol": {
    alt: "Quarto do Solarium 2 com a cama voltada para a janela e o pôr do sol na serra",
    ambiente: "quarto",
  },
  "solarium-2/08-cinema-deck": {
    alt: "Cinema do Solarium 2 aberto para o deck externo",
    ambiente: "cinema",
  },
  "solarium-2/09-deck-tv": {
    alt: "Área de estar do Solarium 2 com Smart TV voltada para o deck",
    ambiente: "sala",
  },
  "solarium-2/10-quarto-decorado": {
    alt: "Quarto do Solarium 2 preparado com decoração para data especial",
    ambiente: "quarto",
  },

  // ── Solarium Completo ────────────────────────────────────────────────────
  "solarium-completo/01-frente-externa": {
    alt: "As duas casas do Solarium Mantiqueira vistas de frente, lado a lado",
    ambiente: "conjunto",
    destaque: true,
  },
  "solarium-completo/02-noite-com-lua": {
    alt: "As duas casas do Solarium iluminadas à noite sob a lua",
    ambiente: "conjunto",
    destaque: true,
  },
  "solarium-completo/03-final-de-tarde": {
    alt: "O conjunto do Solarium Mantiqueira no fim da tarde",
    ambiente: "conjunto",
    destaque: true,
  },
  "solarium-completo/04-drone-serra-itatiaia": {
    alt: "Vista aérea do Solarium com a serra e o Parque Nacional do Itatiaia ao fundo",
    ambiente: "vista",
    destaque: true,
  },
  "solarium-completo/05-drone-itatiaia": {
    alt: "Imagem aérea das montanhas do Itatiaia a partir do Solarium",
    ambiente: "vista",
    destaque: true,
  },
  "solarium-completo/06-drone-serra-papagaio": {
    alt: "Vista aérea em direção à Serra do Papagaio",
    ambiente: "vista",
  },

  // ── Comum ────────────────────────────────────────────────────────────────
  "comum/hero-banheira-por-do-sol": {
    alt: "SPA com piscina infinita aquecida e vista para a Serra da Mantiqueira ao pôr do sol",
    ambiente: "spa",
  },
};

/** Ambientes aceitos — espelha o enum do schema em `src/config/galeria.ts`. */
export const AMBIENTES = [
  "vista",
  "spa",
  "cinema",
  "quarto",
  "cozinha",
  "sala",
  "externa",
  "amanhecer",
  "conjunto",
];

export const ESTACOES = ["verde", "seca", "indiferente"];
