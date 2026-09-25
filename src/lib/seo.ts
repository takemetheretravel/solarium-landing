import type { Metadata } from "next";

/**
 * Endereço canônico do site. Fixo de propósito: canonical, og:url e sitemap
 * não podem variar com o ambiente (preview), senão o Google indexa a URL errada.
 */
export const SITE_URL = "https://www.solariummantiqueira.com";

export const NOME_SITE = "Solarium Mantiqueira";

/**
 * Caminhos nunca rastreados: fluxo de reserva e pagamento (a página de
 * pagamento vive em /reservar/[draftId]/pagamento), admin, API e diagnóstico.
 */
export const BLOQUEADOS_ROBOTS = ["/reservar", "/api", "/admin", "/debug", "/braspag-3ds-test"];

/** Imagens de compartilhamento 1200x630, geradas por `scripts/gerar-og.mjs`. */
export const OG_IMAGENS = {
  home: "/og/solarium-mantiqueira.jpg",
  "solarium-1": "/og/solarium-1.jpg",
  "solarium-2": "/og/solarium-2.jpg",
  "solarium-completo": "/og/solarium-completo.jpg",
} as const;

/** Limites acima dos quais o Google corta o snippet. */
export const LIMITE_TITLE = 65;
export const LIMITE_DESCRIPTION = 160;

/**
 * Title e description das páginas que disputam busca local. Texto definido na
 * rodada SEO-1 — cada casa cita Itanhandu no title.
 */
export const SEO_PAGINAS = {
  "/": {
    title: "Solarium Mantiqueira · Casas com SPA e vista em Itanhandu, MG",
    description:
      "Duas casas em Itanhandu (MG), na Serra da Mantiqueira, com SPA aquecido de borda infinita, vista para a Serra Fina e cinema privativo. Reserve direto.",
  },
  "/solarium-1": {
    title: "Solarium 1 · Casa com SPA e vista da Serra Fina, Itanhandu MG",
    description:
      "Casa para casais em Itanhandu, na Serra da Mantiqueira: SPA com hidro e borda infinita, banheira com vista para a Serra Fina e piso aquecido.",
  },
  "/solarium-2": {
    title: "Solarium 2 · Casa com cinema e SPA na serra, Itanhandu MG",
    description:
      "Casa em Itanhandu com cinema integrado, SPA de imersão com teto retrátil e vista para a Serra da Mantiqueira. Para casais, acomoda até 4.",
  },
  "/solarium-completo": {
    title: "Solarium Completo · Duas casas para até 8, Itanhandu MG",
    description:
      "As duas casas do Solarium, em Itanhandu (MG), para dois casais ou grupos de até 8 pessoas. Cada casal na sua casa, a mesma vista da serra.",
  },
  "/pacotes": {
    title: "Pacotes de estadia na Serra da Mantiqueira · Solarium Mantiqueira",
    description:
      "Pacotes com as noites e os itens que a maioria dos hóspedes pede, numa reserva só, nas casas do Solarium em Itanhandu, Serra da Mantiqueira.",
  },
  "/experiencias": {
    title: "O que fazer em Itanhandu e região · Solarium Mantiqueira",
    description:
      "Cachoeiras, trilhas, Maria Fumaça, queijarias e cesta de café com produtores locais: o que fazer em Itanhandu e no entorno da Serra da Mantiqueira.",
  },
} as const;

type Entrada = {
  /** Caminho a partir da raiz, com barra inicial. Vira o canonical. */
  caminho: string;
  title: string;
  description: string;
  /** Caminho ou URL da imagem de compartilhamento. Padrão: a da home. */
  imagem?: string;
  imagemAlt?: string;
};

/**
 * Metadados completos de uma página: title absoluto (sem o template do
 * layout), canonical e og/twitter próprios. Sem isto a página herda og e
 * twitter da home — o Next não mescla esses objetos, substitui.
 */
export function metadadosPagina({ caminho, title, description, imagem, imagemAlt }: Entrada): Metadata {
  const url = caminho === "/" ? SITE_URL : `${SITE_URL}${caminho}`;
  const img = imagem ?? OG_IMAGENS.home;
  const ehOg = img.startsWith("/og/");
  const imagens = [
    {
      url: img,
      ...(ehOg ? { width: 1200, height: 630 } : {}),
      alt: imagemAlt ?? NOME_SITE,
    },
  ];

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: NOME_SITE,
      locale: "pt_BR",
      type: "website",
      images: imagens,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [img],
    },
  };
}

/** Atalho para as páginas com texto fixado em `SEO_PAGINAS`. */
export function metadadosDe(caminho: keyof typeof SEO_PAGINAS, imagem?: string, imagemAlt?: string): Metadata {
  const { title, description } = SEO_PAGINAS[caminho];
  return metadadosPagina({ caminho, title, description, imagem, imagemAlt });
}
