/**
 * Fonte única das fotos do site: os manifestos de `content/galerias/*.json`
 * (gerados de `galerias-local/` por `npm run galerias:preparar`, servidos pelo
 * Supabase Storage). Nenhum componente monta URL de imagem na mão — tudo
 * passa por `urlGaleria()`.
 *
 * **As pastas do Drive decidem os chips** (IMG-1a-ajustes-2): uma foto
 * aparece no chip de cada pasta em que está. Não há exclusão automática.
 */
import solarium1 from "../../../content/galerias/solarium-1.json";
import solarium2 from "../../../content/galerias/solarium-2.json";
import completo from "../../../content/galerias/completo.json";
import experiencias from "../../../content/galerias/experiencias.json";
import comum from "../../../content/galerias/comum.json";
import { podeSerVitrine, type Grupo, type ItemGaleria } from "./manifesto";
import { ordenarPastas, rotuloDaPasta } from "./pastas";
export { urlGaleria, NEBLINA } from "./url";

export { podeSerVitrine };
export type { Grupo, ItemGaleria };

const MANIFESTOS: Record<Grupo, ItemGaleria[]> = {
  "solarium-1": solarium1 as ItemGaleria[],
  "solarium-2": solarium2 as ItemGaleria[],
  completo: completo as ItemGaleria[],
  experiencias: experiencias as ItemGaleria[],
  comum: comum as ItemGaleria[],
};

/** Slug de casa no site → grupo do manifesto. */
export const GRUPO_DA_CASA: Record<string, Grupo> = {
  "solarium-1": "solarium-1",
  "solarium-2": "solarium-2",
  "solarium-completo": "completo",
};

/**
 * O que pode aparecer no site: não excluída; foto com crédito pendente só
 * com o crédito preenchido. (Nas casas nada é excluído: está na pasta,
 * aparece.)
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

/** Pastas do item (manifesto antigo sem `pastas`: o ambiente e `tambemEm`). */
export function pastasDoItem(i: ItemGaleria): string[] {
  return i.pastas?.length ? i.pastas : [i.ambiente, ...i.tambemEm];
}

/**
 * Capa do grupo: a `destaque` da curadoria, se ainda está numa pasta e pode
 * ser vitrine. Sem ela, a primeira foto de `vista`/`spa` que pode ser
 * vitrine; por último, a primeira vitrine qualquer.
 */
export function destaque(grupo: Grupo): ItemGaleria | undefined {
  const lista = MANIFESTOS[grupo].filter(podeAparecer).sort((a, b) => a.ordem - b.ordem);
  return (
    lista.find((i) => i.destaque && podeSerVitrine(i)) ??
    lista.find((i) => podeSerVitrine(i) && pastasDoItem(i).some((p) => p === "vista" || p === "spa")) ??
    lista.find(podeSerVitrine)
  );
}

export function buscarPorArquivo(arquivo: string): ItemGaleria | undefined {
  for (const lista of Object.values(MANIFESTOS)) {
    const achado = lista.find((i) => i.arquivo === arquivo);
    if (achado) return achado;
  }
  return undefined;
}

export type Categoria = { id: string; rotulo: string; itens: ItemGaleria[] };

/** Chips em que a foto aparece: um por pasta do Drive. */
export function chipsDoItem(i: ItemGaleria): string[] {
  return ordenarPastas(pastasDoItem(i));
}

/**
 * Ordem dentro de um chip: primeiro as fotos numeradas no nome ("01 ",
 * "02-"…) daquela pasta, pelo número; depois as demais, na ordem da galeria.
 */
function ordenarNoChip(itens: ItemGaleria[], pasta: string): ItemGaleria[] {
  return itens
    .map((i, pos) => ({ i, pos, n: i.ordemNaPasta?.[pasta] }))
    .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.pos - b.pos)
    .map((x) => x.i);
}

/**
 * "Todas" primeiro, depois um chip por pasta, na ordem da tabela de pastas.
 * Uma foto em várias pastas aparece em cada chip; dentro de um chip (e em
 * "Todas"), nunca repete. Chip sem foto não aparece.
 */
export function porAmbiente(itens: ItemGaleria[]): Categoria[] {
  const unicos = itens.filter((i, k) => itens.findIndex((x) => x.arquivo === i.arquivo) === k);
  const pastas = ordenarPastas(unicos.flatMap(pastasDoItem));
  return [
    { id: "todas", rotulo: "Todas", itens: unicos },
    ...pastas.map((p) => ({
      id: p,
      rotulo: rotuloDaPasta(p),
      itens: ordenarNoChip(
        unicos.filter((i) => pastasDoItem(i).includes(p)),
        p,
      ),
    })),
  ].filter((c) => c.itens.length > 0);
}

/**
 * Tudo que a página de uma casa precisa. Hero (capa) e mosaico nunca repetem
 * entre si; a grade por pasta mostra cada chip completo. `todas` é a
 * sequência do lightbox.
 */
export type GaleriaDaCasa = {
  hero: ItemGaleria;
  mosaico: ItemGaleria[];
  categorias: Categoria[];
  todas: ItemGaleria[];
};

const NO_MOSAICO = 5;

/**
 * Mosaico: as primeiras fotos das pastas `vista` e `spa` que podem ser
 * vitrine, fora a capa. Quase-duplicatas da capa não existem mais no
 * manifesto (o preparo deixa uma por grupo). Se faltar, completa com outras
 * vitrines.
 */
function mosaicoDaCasa(todas: ItemGaleria[], hero: ItemGaleria): ItemGaleria[] {
  const livres = todas.filter((i) => i.arquivo !== hero.arquivo && podeSerVitrine(i));
  const vistaSpa = livres.filter((i) => pastasDoItem(i).some((p) => p === "vista" || p === "spa"));
  const resto = livres.filter((i) => !vistaSpa.includes(i));
  return [...vistaSpa, ...resto].slice(0, NO_MOSAICO);
}

export function montarGaleriaDaCasa(slug: string, mes?: number): GaleriaDaCasa {
  const grupo = GRUPO_DA_CASA[slug];
  if (!grupo) throw new Error(`Casa sem galeria: ${slug}`);
  const hero = destaque(grupo);
  if (!hero) throw new Error(`Casa sem capa válida: ${slug}`);

  if (grupo !== "completo") {
    const todas = carregarGaleria(grupo, mes);
    return { hero, mosaico: mosaicoDaCasa(todas, hero), categorias: porAmbiente(todas), todas };
  }

  // Completo: as pastas do conjunto e mais um chip por casa. O mosaico junta
  // fotos do conjunto com a capa de cada casa.
  const conjunto = carregarGaleria("completo", mes);
  const s1 = carregarGaleria("solarium-1", mes);
  const s2 = carregarGaleria("solarium-2", mes);
  const capaS1 = destaque("solarium-1");
  const capaS2 = destaque("solarium-2");
  const livres = conjunto.filter((i) => i.arquivo !== hero.arquivo && podeSerVitrine(i));
  const [grande, ...resto] = livres;
  const mosaico = [grande, capaS1, capaS2, ...resto].filter((i): i is ItemGaleria => Boolean(i)).slice(0, NO_MOSAICO);
  const todas = [...conjunto, ...s1, ...s2];
  const [, ...doConjunto] = porAmbiente(conjunto);
  const categorias: Categoria[] = [
    { id: "todas", rotulo: "Todas", itens: todas },
    ...doConjunto,
    { id: "solarium-1", rotulo: "Solarium 1", itens: s1 },
    { id: "solarium-2", rotulo: "Solarium 2", itens: s2 },
  ].filter((c) => c.itens.length > 0);
  return { hero, mosaico, categorias, todas };
}
