import { getPacoteV2, getExtra, precoExtra, PACOTES_V2, type PacoteV2 } from "@/config/precos-e-extras";
import { getPackageBySlug, PACKAGES, type PackageConfig } from "@/config/packages";
import { PROPERTIES } from "@/config/properties";

/**
 * Forma que a página de pacote consome, seja o pacote novo ou um dos antigos.
 *
 * Existe para que os cinco pacotes rendam no MESMO template — o que já está em
 * produção. Quem calcula o preço é outra camada: `pacoteV2` presente significa
 * motor novo; ausente, o motor antigo, sem nenhuma mudança de valor ou de copy.
 */
export type VistaPacote = {
  slug: string;
  nome: string;
  noites: number;
  /** Linha sobreposta ao hero. */
  tagline: string;
  /** Parágrafo de abertura da coluna esquerda. */
  descricao: string;
  imagem: string;
  /** Bullets de "O que está incluído". */
  inclusos: string[];
  /** Aviso de regra de datas, quando o pacote tem uma. */
  aviso: string | null;
  /** Duração variável: o card diz "a partir de N noites". */
  duracaoVariavel: boolean;
  /** Presente = motor V2. Ausente = pacote legado, intocado. */
  pacoteV2: PacoteV2 | null;
  /** Legado, para o cartão de reserva antigo. */
  legado: PackageConfig | null;
};

function rotuloNoites(p: PacoteV2): number {
  return p.noitesMin;
}

/** "3 noites" quando fixo; "A partir de 3 noites" quando a duração varia. */
export function textoNoites(v: { noites: number; duracaoVariavel: boolean }): string {
  return v.duracaoVariavel ? `A partir de ${v.noites} noites` : `${v.noites} noites`;
}

/** Bullets do V2: as noites, cada item incluso com o valor cheio de menu, e o concierge. */
function inclusosV2(p: PacoteV2): string[] {
  // A preposição vem junto do complemento: contrair "em as" na montagem é o tipo
  // de erro que só aparece depois de publicado.
  const casa =
    p.properties[0] === "solarium-completo"
      ? "nas duas casas, só de vocês"
      : "em uma casa completa, só de vocês";
  const linhas = [
    p.noitesMax === p.noitesMin
      ? `${p.noitesMin} noites ${casa}`
      : `A partir de ${p.noitesMin} noites ${casa}`,
  ];

  for (const item of p.inclusos) {
    const extra = getExtra(item.extraId);
    if (!extra) continue;
    // Sem preço aqui: o valor de cada item aparece na página do pacote, no bloco
    // de extras. Card e lista de inclusos carregam só o nome e a quantidade.
    linhas.push(rotuloIncluso(extra.id, extra.nome, item.qtd, p));
  }

  linhas.push("Concierge para personalizar a estadia");
  return linhas;
}

/**
 * Quantidade explícita nas cestas. Nunca deixar ambíguo se é uma cesta para a
 * estadia inteira ou uma por manhã.
 */
function rotuloIncluso(id: string, nome: string, qtd: number, p: PacoteV2): string {
  if (!id.startsWith("cesta_")) return nome;

  if (p.properties[0] === "solarium-completo") {
    return `${qtd} cestas de café da manhã, uma para cada casa`;
  }
  // Só o Fim de Semana Completo tem manhã fixa (sábado). Qualquer pacote de
  // duração variável escolhe a manhã — prender ao sábado era copy herdada.
  const duracaoFixa = p.noitesMax === p.noitesMin;
  if (qtd === 1) {
    if (duracaoFixa && p.checkinDows?.length === 1 && p.checkinDows[0] === 5) {
      return "1 cesta de café da manhã, no sábado";
    }
    return "1 cesta de café da manhã, na manhã que vocês escolherem";
  }
  return `${qtd} cestas de café da manhã`;
}

function avisoDatasV2(p: PacoteV2): string | null {
  if (p.exigeFeriado) {
    return "Escolha as datas ao lado para ver o valor. Este pacote vale para três noites que contenham um feriado nacional.";
  }
  if (p.checkinDows?.length === 1 && p.checkinDows[0] === 5) {
    return "Escolha as datas ao lado para ver o valor. A chegada deste pacote é sempre na sexta.";
  }
  if (p.properties[0] === "solarium-completo") {
    return "Escolha as datas ao lado para ver o valor. São as duas casas, a partir de duas noites, em qualquer período.";
  }
  return null;
}

/** Imagem de acervo da casa elegível, quando o pacote não tem uma própria. */
function imagemDeFallback(p: PacoteV2): string {
  const casa = PROPERTIES.find((x) => x.slug === p.properties[0]);
  return casa?.heroImage ?? "/images/comum/hero-banheira-por-do-sol.jpg";
}

export function vistaPacote(slug: string, v2Ativo: boolean): VistaPacote | null {
  const v2 = v2Ativo ? getPacoteV2(slug) : undefined;
  if (v2) {
    return {
      slug: v2.slug,
      nome: v2.nome,
      noites: rotuloNoites(v2),
      tagline: v2.descricao,
      descricao: v2.descricaoLonga ?? v2.descricao,
      imagem: v2.imagem ?? imagemDeFallback(v2),
      inclusos: inclusosV2(v2),
      aviso: avisoDatasV2(v2),
      duracaoVariavel: v2.noitesMax !== v2.noitesMin,
      pacoteV2: v2,
      legado: null,
    };
  }

  const antigo = getPackageBySlug(slug);
  if (!antigo) return null;

  return {
    slug: antigo.slug,
    nome: antigo.name,
    noites: antigo.nights,
    tagline: antigo.tagline,
    descricao: antigo.description,
    imagem: antigo.image,
    inclusos: antigo.included,
    duracaoVariavel: false,
    aviso: antigo.weekdaysOnly
      ? "Este pacote é válido para noites de segunda a quinta, fora de feriados. Para finais de semana e datas de feriado, fale com nosso concierge."
      : null,
    pacoteV2: null,
    legado: antigo,
  };
}

/** Os cinco slugs que a grade e o roteamento precisam conhecer. */
export function slugsDePacote(v2Ativo: boolean): string[] {
  // DERIVADO do catálogo, nunca escrito à mão. Era uma lista fixa, e um pacote
  // novo no config dava 404 na própria página — terceira lista de slugs, o mesmo
  // caminho paralelo que já custou caro antes.
  const legado = PACKAGES.map((p) => p.slug);
  if (!v2Ativo) return legado;
  const v2 = PACOTES_V2.filter((p) => p.ativo).map((p) => p.slug);
  // Meio de Semana e Imersão seguem no motor antigo, com preço e copy inalterados.
  return Array.from(new Set([...v2, ...legado]));
}
