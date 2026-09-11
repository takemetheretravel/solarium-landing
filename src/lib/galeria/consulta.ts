import type { Ambiente, Foto } from "@/config/galeria";

/**
 * Regras de leitura da galeria, separadas do componente de propósito.
 *
 * O componente é client-side e cheio de DOM; estas funções são o que decide o
 * que o hóspede vê, e ficam aqui para o teste exercitá-las sem navegador.
 */

export const AMBIENTE_ROTULO: Record<Ambiente, string> = {
  vista: "Vista",
  spa: "SPA",
  cinema: "Cinema",
  quarto: "Quarto",
  cozinha: "Cozinha",
  sala: "Sala",
  externa: "Área externa",
  amanhecer: "Amanhecer",
  conjunto: "Conjunto",
};

/** Ordem de exibição: `ordem` crescente, empate desfeito pelo `id` (estável). */
export function ordenarFotos(fotos: readonly Foto[]): Foto[] {
  return [...fotos].sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
}

/**
 * As fotos do mosaico. São as marcadas como `destaque`, limitadas a `quantas`.
 *
 * Se a curadoria esquecer de marcar destaques, o mosaico não pode ficar vazio —
 * cai para as primeiras da ordem. Página sem foto é pior que mosaico não curado.
 */
export function fotosDoMosaico(fotos: readonly Foto[], quantas = 5): Foto[] {
  const ordenadas = ordenarFotos(fotos);
  const destaques = ordenadas.filter((f) => f.destaque);
  return (destaques.length > 0 ? destaques : ordenadas).slice(0, quantas);
}

/** Ambientes presentes nesta casa, na ordem em que aparecem na galeria. */
export function ambientesDisponiveis(fotos: readonly Foto[]): Ambiente[] {
  const vistos: Ambiente[] = [];
  for (const foto of ordenarFotos(fotos)) {
    if (!vistos.includes(foto.ambiente)) vistos.push(foto.ambiente);
  }
  return vistos;
}

/** `null` = sem filtro, devolve tudo. */
export function filtrarPorAmbiente(fotos: readonly Foto[], ambiente: Ambiente | null): Foto[] {
  const ordenadas = ordenarFotos(fotos);
  return ambiente === null ? ordenadas : ordenadas.filter((f) => f.ambiente === ambiente);
}

/** Posição da foto na lista, ou `-1`. Base do deep-link `?foto={id}`. */
export function indiceDaFoto(fotos: readonly Foto[], id: string | null | undefined): number {
  if (!id) return -1;
  return fotos.findIndex((f) => f.id === id);
}

/**
 * Traduz `?foto={id}` em estado inicial da lightbox.
 *
 * Um `id` que não existe (link velho, foto removida, URL digitada errado) NÃO
 * abre a lightbox numa foto arbitrária: devolve `null` e a página carrega
 * normal. Abrir a foto errada é pior que não abrir nada.
 *
 * Quando o `id` existe mas está fora do filtro ativo, o filtro cede — o link
 * apontava para aquela foto, não para aquela combinação de filtro.
 */
export function estadoInicialDoDeepLink(
  fotos: readonly Foto[],
  id: string | null | undefined,
): { indice: number; ambiente: Ambiente | null } | null {
  const alvo = ordenarFotos(fotos).find((f) => f.id === id);
  if (!alvo) return null;
  return { indice: indiceDaFoto(ordenarFotos(fotos), alvo.id), ambiente: null };
}

/** Índices da anterior e da próxima, com volta no fim da lista (para preload). */
export function vizinhas(total: number, indice: number): { anterior: number; proxima: number } {
  if (total <= 0) return { anterior: -1, proxima: -1 };
  return {
    anterior: (indice - 1 + total) % total,
    proxima: (indice + 1) % total,
  };
}
