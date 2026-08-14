import { getPacoteV2, getExtra, precoExtra, type PacoteV2 } from "@/config/precos-e-extras";
import { getPackageBySlug, type PackageConfig } from "@/config/packages";
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
  /** Presente = motor V2. Ausente = pacote legado, intocado. */
  pacoteV2: PacoteV2 | null;
  /** Legado, para o cartão de reserva antigo. */
  legado: PackageConfig | null;
};

function rotuloNoites(p: PacoteV2): number {
  return p.noitesMin;
}

/** Bullets do V2: as noites, cada item incluso com o valor cheio de menu, e o concierge. */
function inclusosV2(p: PacoteV2): string[] {
  const casa = p.properties[0] === "solarium-completo" ? "as duas casas" : "casa completa e exclusiva";
  const linhas = [
    p.noitesMax === p.noitesMin
      ? `${p.noitesMin} noites em ${casa}`
      : `A partir de ${p.noitesMin} noites em ${casa}`,
  ];

  for (const item of p.inclusos) {
    const extra = getExtra(item.extraId);
    if (!extra) continue;
    // Preço por período resolve fds/semana só com datas; aqui mostramos o de menu
    // da casa elegível, que é o mesmo usado no cálculo.
    const valor = precoExtra(extra);
    linhas.push(valor > 0 ? `${extra.nome} — R$ ${valor}` : extra.nome);
  }

  linhas.push("Concierge para personalizar a estadia");
  return linhas;
}

function avisoDatasV2(p: PacoteV2): string | null {
  if (p.exigeFeriado) {
    return "Este pacote vale para três noites que contenham um feriado nacional. O calendário libera só as datas elegíveis.";
  }
  if (p.checkinDows?.length === 1 && p.checkinDows[0] === 5) {
    return "Check-in na sexta, check-out no domingo. O calendário libera só as sextas.";
  }
  if (p.properties[0] === "solarium-completo") {
    return "As duas casas, a partir de duas noites, em qualquer período.";
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
      descricao: v2.descricao,
      imagem: v2.imagem ?? imagemDeFallback(v2),
      inclusos: inclusosV2(v2),
      aviso: avisoDatasV2(v2),
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
    aviso: antigo.weekdaysOnly
      ? "Este pacote é válido para noites de segunda a quinta, fora de feriados. Para finais de semana e datas de feriado, fale com nosso concierge."
      : null,
    pacoteV2: null,
    legado: antigo,
  };
}

/** Os cinco slugs que a grade e o roteamento precisam conhecer. */
export function slugsDePacote(v2Ativo: boolean): string[] {
  if (!v2Ativo) return getSlugsLegado();
  const v2 = ["fim-de-semana-completo", "feriado-na-serra", "dois-casais"];
  // Meio de Semana e Imersão seguem no motor antigo, com preço e copy inalterados.
  return [...v2, "meio-de-semana", "imersao-na-serra"];
}

function getSlugsLegado(): string[] {
  return ["meio-de-semana", "imersao-na-serra", "data-especial"];
}
