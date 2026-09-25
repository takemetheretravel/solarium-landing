/**
 * Regras de nome da IMG-0. Funções puras, testadas em
 * `src/lib/galerias/nomes.test.ts`.
 */

/** Minúsculas, sem acento, só [a-z0-9] separados por hífen. */
export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pasta de ambiente do Drive → slug. Arquivo solto na raiz da casa = "geral". */
export function normalizarAmbiente(pasta: string | null): string {
  if (!pasta) return "geral";
  return slug(pasta.replace(/_/g, " "));
}

/**
 * Quando a mesma foto está em várias pastas, fica na mais específica.
 * Qualquer `banheiro*` ocupa a posição de "banheiro".
 */
export const PRIORIDADE_AMBIENTE = [
  "spa",
  "quarto",
  "cinema",
  "cozinha",
  "area-gourmet",
  "banheiro",
  "sala",
  "rede",
  "externa",
  "vista",
  "amanhecer",
  "conjunto",
  "geral",
];

export function prioridadeAmbiente(ambiente: string): number {
  const base = ambiente.startsWith("banheiro") ? "banheiro" : ambiente;
  const i = PRIORIDADE_AMBIENTE.indexOf(base);
  return i === -1 ? PRIORIDADE_AMBIENTE.length : i;
}

/**
 * Nomes próprios de pessoas que aparecem nos arquivos do Drive. Qualquer
 * nome novo entra aqui; o teste de nomes usa esta lista.
 */
export const NOMES_DE_PESSOAS = ["aline", "guilherme", "elora", "diana", "silvana", "lucas", "guida"];

/** Descrições pessoais trocadas por descrição de cena. */
const TROCAS: [RegExp, string][] = [
  [/\bamenities\b/g, "itens de banho"],
  [/\bgravida na poltrona\b/g, "leitura na poltrona"],
  [/\breflexo gravida na rede\b/g, "reflexo na rede"],
  [/\bgravida\b/g, "hospede"],
];

/**
 * Descrição provisória a partir do nome original: tira prefixos do Drive,
 * nomes de pessoas e descrições pessoais. A descrição final vem da
 * curadoria visual (`curadoria.json`); esta só vale enquanto ela não existe.
 */
export function descricaoDoNomeOriginal(nomeArquivo: string): string {
  let t = nomeArquivo.replace(/\.[^.]+$/, "");
  t = t.replace(/^C[oó]pia de\s+/i, "");
  t = t.replace(/^Ret_/i, "");
  t = t.replace(/^Solarium (Completo|\d)\s*[_-]\s*/i, "");
  t = t.replace(/^Ret_/i, "");
  t = t.replace(/\(\d+\)$/, "");
  let s = slug(t).replace(/-/g, " ");
  for (const [re, por] of TROCAS) s = s.replace(re, por);
  const semNomes = s
    .split(" ")
    .filter((p) => p && !NOMES_DE_PESSOAS.includes(p))
    .join(" ");
  return slug(semNomes) || "foto";
}

/**
 * Nome estável: só o slug da descrição. A ordem mora no campo `ordem` do
 * manifesto — mudar a ordem não muda o caminho no bucket. Colisão na mesma
 * pasta ganha `-2`, `-3`… (`usados` guarda os caminhos já atribuídos).
 */
export function nomeFinal(pasta: string, descricao: string, ext: "jpg" | "png", usados: Set<string>): string {
  const base = slug(descricao) || "foto";
  for (let n = 1; ; n++) {
    const nome = `${n === 1 ? base : `${base}-${n}`}.${ext}`;
    if (!usados.has(`${pasta}/${nome}`)) {
      usados.add(`${pasta}/${nome}`);
      return nome;
    }
  }
}

/** Nome de pessoa em qualquer segmento do caminho. */
export function contemNomeDePessoa(caminho: string): string | null {
  const partes = slug(caminho.replace(/\.[^.]+$/, "")).split("-");
  return NOMES_DE_PESSOAS.find((n) => partes.includes(n)) ?? null;
}
