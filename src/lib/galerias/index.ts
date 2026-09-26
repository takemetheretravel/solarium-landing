/**
 * Fonte única das fotos do site: os manifestos de `content/galerias/*.json`
 * (gerados pela IMG-0, servidos pelo Supabase Storage). Nenhum componente
 * monta URL de imagem na mão — tudo passa por `urlGaleria()`.
 */
import solarium1 from "../../../content/galerias/solarium-1.json";
import solarium2 from "../../../content/galerias/solarium-2.json";
import completo from "../../../content/galerias/completo.json";
import experiencias from "../../../content/galerias/experiencias.json";
import comum from "../../../content/galerias/comum.json";
import ajustesManuais from "../../../content/galerias/ajustes-manuais.json";
import { podeSerVitrine, type Grupo, type ItemGaleria } from "./manifesto";
export { urlGaleria, NEBLINA } from "./url";

export { podeSerVitrine };
export type { Grupo, ItemGaleria };

/**
 * Ajuste manual por cima da curadoria (`content/galerias/ajustes-manuais.json`,
 * formato no topo do DECISOES.md). Chave = `arquivo` do manifesto.
 * - `incluir`: traz de volta uma foto `excluirDoSite` (já está no bucket).
 * - `excluir`: tira do site.
 * - `ambientes`: substitui os chips em que a foto aparece.
 * - `ordem`: substitui a ordem.
 */
export type AjusteManual = { incluir?: boolean; excluir?: boolean; ambientes?: string[]; ordem?: number };

export const AJUSTES: Record<string, AjusteManual> = ajustesManuais as Record<string, AjusteManual>;

function aplicarAjuste(i: ItemGaleria): ItemGaleria {
  const a = AJUSTES[i.arquivo];
  if (!a) return i;
  return {
    ...i,
    excluirDoSite: a.excluir ? true : a.incluir ? false : i.excluirDoSite,
    ordem: a.ordem ?? i.ordem,
  };
}

const MANIFESTOS: Record<Grupo, ItemGaleria[]> = {
  "solarium-1": (solarium1 as ItemGaleria[]).map(aplicarAjuste),
  "solarium-2": (solarium2 as ItemGaleria[]).map(aplicarAjuste),
  completo: (completo as ItemGaleria[]).map(aplicarAjuste),
  experiencias: (experiencias as ItemGaleria[]).map(aplicarAjuste),
  comum: (comum as ItemGaleria[]).map(aplicarAjuste),
};

/** Slug de casa no site → grupo do manifesto. */
export const GRUPO_DA_CASA: Record<string, Grupo> = {
  "solarium-1": "solarium-1",
  "solarium-2": "solarium-2",
  "solarium-completo": "completo",
};

/**
 * O que pode aparecer no site: nunca `excluirDoSite`; foto com crédito
 * pendente só com o crédito preenchido.
 */
export function podeAparecer(i: ItemGaleria): boolean {
  if (i.excluirDoSite) return false;
  if (i.creditoPendente && !i.credito?.trim()) return false;
  return true;
}

/**
 * Estação do mês: de outubro a março a serra está verde, de abril a setembro
 * seca. Dentro de cada ambiente, a estação do momento vem antes; `neutra`
 * fica exatamente onde estava. O mês é o do build: as páginas são estáticas e
 * a próxima publicação atualiza.
 */
export function ordenarPorEstacao(itens: ItemGaleria[], mes = new Date().getMonth() + 1): ItemGaleria[] {
  const primeiro = mes >= 10 || mes <= 3 ? "verde" : "seca";
  const peso = (i: ItemGaleria) => (i.estacao === primeiro ? 0 : 1);
  const saida = [...itens];
  const ambientes = Array.from(new Set(itens.map((i) => i.ambiente)));
  for (const amb of ambientes) {
    const posicoes = saida.flatMap((i, p) => (i.ambiente === amb && i.estacao !== "neutra" ? [p] : []));
    const ordenados = posicoes.map((p) => saida[p]).sort((a, b) => peso(a) - peso(b) || a.ordem - b.ordem);
    posicoes.forEach((p, k) => (saida[p] = ordenados[k]));
  }
  return saida;
}

/** Fotos que o site mostra de um grupo, na ordem da curadoria ajustada à estação. */
export function carregarGaleria(grupo: Grupo, mes?: number): ItemGaleria[] {
  const visiveis = MANIFESTOS[grupo].filter(podeAparecer).sort((a, b) => a.ordem - b.ordem);
  return ordenarPorEstacao(visiveis, mes);
}

/** Capa do grupo. Só vale se puder ser vitrine (sem marca d'água, tela, baixa resolução). */
export function destaque(grupo: Grupo): ItemGaleria | undefined {
  return MANIFESTOS[grupo].find((i) => i.destaque && podeSerVitrine(i) && podeAparecer(i));
}

export function buscarPorArquivo(arquivo: string): ItemGaleria | undefined {
  for (const lista of Object.values(MANIFESTOS)) {
    const achado = lista.find((i) => i.arquivo === arquivo);
    if (achado) return achado;
  }
  return undefined;
}

export type Categoria = { id: string; rotulo: string; itens: ItemGaleria[] };

/** Chips da página de casa, nesta ordem. Categoria sem foto não aparece. */
export const CATEGORIAS: { id: string; rotulo: string; ambientes: (a: string) => boolean }[] = [
  { id: "vista-spa", rotulo: "Vista e SPA", ambientes: (a) => ["vista", "amanhecer", "spa"].includes(a) },
  { id: "quarto", rotulo: "Quarto", ambientes: (a) => a === "quarto" },
  { id: "cinema", rotulo: "Cinema", ambientes: (a) => a === "cinema" },
  { id: "cozinha", rotulo: "Cozinha e área gourmet", ambientes: (a) => ["cozinha", "area-gourmet"].includes(a) },
  { id: "externa", rotulo: "Área externa", ambientes: (a) => ["externa", "geral"].includes(a) },
  { id: "sala-rede", rotulo: "Sala e rede", ambientes: (a) => ["sala", "rede"].includes(a) },
  { id: "banheiro", rotulo: "Banheiros", ambientes: (a) => a.startsWith("banheiro") },
];

/**
 * Chips em que a foto aparece: os do ajuste manual, se houver; senão os do
 * ambiente e de cada pasta em `tambemEm` (a mesma foto estava em várias pastas
 * do Drive). Ambiente fora do mapa cai em "Área externa" em vez de sumir.
 */
export function chipsDoItem(i: ItemGaleria): string[] {
  const manual = AJUSTES[i.arquivo]?.ambientes;
  if (manual?.length) return manual;
  const ids = CATEGORIAS.filter((c) => [i.ambiente, ...i.tambemEm].some(c.ambientes)).map((c) => c.id);
  return ids.length ? ids : ["externa"];
}

/** Uma foto pode estar em mais de um chip; dentro de um chip, nunca repete. */
export function porAmbiente(itens: ItemGaleria[]): Categoria[] {
  return CATEGORIAS.map(({ id, rotulo }) => ({
    id,
    rotulo,
    itens: itens.filter((i) => chipsDoItem(i).includes(id)),
  })).filter((c) => c.itens.length > 0);
}

/**
 * Tudo que a página de uma casa precisa. Hero (capa) e mosaico (5 vitrines
 * seguintes) nunca repetem entre si. A grade por ambiente mostra cada
 * ambiente completo — pode repetir foto do mosaico e uma foto pode estar em
 * mais de um chip (IMG-1a-ajustes). `todas` é a sequência do lightbox.
 */
export type GaleriaDaCasa = {
  hero: ItemGaleria;
  mosaico: ItemGaleria[];
  categorias: Categoria[];
  todas: ItemGaleria[];
};

const NO_MOSAICO = 5;

function primeirasVitrines(itens: ItemGaleria[], n: number, fora: Set<string>): ItemGaleria[] {
  return itens.filter((i) => podeSerVitrine(i) && !fora.has(i.arquivo)).slice(0, n);
}

export function montarGaleriaDaCasa(slug: string, mes?: number): GaleriaDaCasa {
  const grupo = GRUPO_DA_CASA[slug];
  if (!grupo) throw new Error(`Casa sem galeria: ${slug}`);
  const hero = destaque(grupo);
  if (!hero) throw new Error(`Casa sem capa válida: ${slug}`);

  if (grupo !== "completo") {
    const todas = carregarGaleria(grupo, mes);
    const fora = new Set([hero.arquivo]);
    const mosaico = primeirasVitrines(todas, NO_MOSAICO, fora);
    mosaico.forEach((i) => fora.add(i.arquivo));
    return { hero, mosaico, categorias: porAmbiente(todas), todas };
  }

  // Completo: a galeria do conjunto + as duas casas. O mosaico junta fotos do
  // conjunto com a capa de cada casa; a grade tem um chip por casa.
  const conjunto = carregarGaleria("completo", mes);
  const s1 = carregarGaleria("solarium-1", mes);
  const s2 = carregarGaleria("solarium-2", mes);
  const capaS1 = destaque("solarium-1");
  const capaS2 = destaque("solarium-2");
  const fora = new Set([hero.arquivo]);
  const [grande, ...resto] = primeirasVitrines(conjunto, 3, fora);
  const mosaico = [grande, capaS1, capaS2, ...resto].filter((i): i is ItemGaleria => Boolean(i)).slice(0, NO_MOSAICO);
  mosaico.forEach((i) => fora.add(i.arquivo));
  const categorias: Categoria[] = [
    { id: "conjunto", rotulo: "Conjunto", itens: conjunto },
    { id: "solarium-1", rotulo: "Solarium 1", itens: s1 },
    { id: "solarium-2", rotulo: "Solarium 2", itens: s2 },
  ].filter((c) => c.itens.length > 0);
  return { hero, mosaico, categorias, todas: [...conjunto, ...s1, ...s2] };
}
