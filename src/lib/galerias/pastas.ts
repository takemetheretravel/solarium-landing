/**
 * Pastas do Drive → chips da galeria (IMG-1a-ajustes-2). As pastas que o
 * Lucas organizou em `galerias-local/` são a fonte da verdade dos ambientes.
 * O slug é o nome da pasta normalizado (`banheiro_suíte` → `banheiro-suite`);
 * arquivos soltos na raiz da casa ficam em `geral`.
 *
 * Módulo leve: não importa manifesto (usado pelo script e pelo site).
 */

export const PASTAS: { slug: string; rotulo: string }[] = [
  { slug: "vista", rotulo: "Vista" },
  { slug: "spa", rotulo: "SPA" },
  { slug: "quarto", rotulo: "Quarto" },
  { slug: "cinema", rotulo: "Cinema" },
  { slug: "banheiro-suite", rotulo: "Banheiro da suíte" },
  { slug: "banheiro-social", rotulo: "Banheiro social" },
  { slug: "banheiro", rotulo: "Banheiro" },
  { slug: "cozinha", rotulo: "Cozinha" },
  { slug: "area-gourmet", rotulo: "Área gourmet" },
  { slug: "sala", rotulo: "Sala" },
  { slug: "rede", rotulo: "Rede" },
  { slug: "amanhecer", rotulo: "Amanhecer" },
  { slug: "externa", rotulo: "Área externa" },
  { slug: "conjunto", rotulo: "As duas casas" },
  { slug: "geral", rotulo: "Mais fotos" },
];

const POSICAO = new Map(PASTAS.map((p, i) => [p.slug, i]));

/** Pasta nova, fora da tabela: vai antes de "Mais fotos", em ordem alfabética. */
export function posicaoDaPasta(slug: string): number {
  return POSICAO.get(slug) ?? PASTAS.length - 1.5;
}

export function rotuloDaPasta(slug: string): string {
  const conhecida = PASTAS.find((p) => p.slug === slug);
  if (conhecida) return conhecida.rotulo;
  const t = slug.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ordenarPastas(slugs: string[]): string[] {
  return Array.from(new Set(slugs)).sort((a, b) => posicaoDaPasta(a) - posicaoDaPasta(b) || a.localeCompare(b));
}

/**
 * Número no começo do nome define a ordem dentro da pasta: "01 Foto.jpg",
 * "02-foto.jpg", "3_foto.jpg". Aceita o prefixo "Cópia de " do download do Drive.
 */
export function numeroNoNome(nomeArquivo: string): number | undefined {
  const m = /^(?:c[oó]pia de\s+)?(\d{1,4})(?=[\s_.-])/i.exec(nomeArquivo);
  return m ? Number(m[1]) : undefined;
}

/** Pastas ignoradas em qualquer nível: o jeito de tirar uma foto do site. */
export const PASTA_FORA = "_fora";
