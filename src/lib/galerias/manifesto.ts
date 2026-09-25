/**
 * Formato dos manifestos em `content/galerias/*.json`, gerados por
 * `npm run galerias:preparar` (IMG-0). Gerados, nunca editados à mão: o que é
 * curadoria humana mora em `content/galerias/curadoria.json`.
 *
 * `arquivo` é o caminho dentro do bucket `galerias` do Supabase Storage.
 */

export const ESTACOES = ["verde", "seca", "neutra"] as const;
export type Estacao = (typeof ESTACOES)[number];

export const GRUPOS = ["solarium-1", "solarium-2", "completo", "experiencias", "comum"] as const;
export type Grupo = (typeof GRUPOS)[number];

export type ItemGaleria = {
  arquivo: string;
  largura: number;
  altura: number;
  alt: string;
  ambiente: string;
  estacao: Estacao;
  destaque: boolean;
  ordem: number;
  /** Outras pastas de ambiente onde a mesma foto (mesmo SHA-256) estava. */
  tambemEm: string[];
  baixaResolucao: boolean;
  excluirDoSite: boolean;
  creditoPendente: boolean;
  /** Marca d'água "T" no canto: pode ir para a galeria, nunca para capa, mosaico ou Google. */
  marcaDagua: boolean;
  /** TV/tela mostrando Netflix ou outra interface: mesmas restrições, e no fim do ambiente. */
  telaComConteudo: boolean;
  /** Opcional. Crédito da foto ("Foto: …"); obrigatório para exibir item com `creditoPendente`. */
  credito?: string;
  /** Opcional. Versão retrato para o hero no celular (IMG-1b). */
  destaqueMobile?: boolean;
  /** Opcional. Ponto de recorte do hero quando não há versão retrato (IMG-1b). */
  foco?: "centro" | "esquerda" | "direita";
};

/** Pode ser capa, entrar no mosaico e ir para o Perfil da Empresa no Google. */
export function podeSerVitrine(i: ItemGaleria): boolean {
  return !i.excluirDoSite && !i.baixaResolucao && !i.marcaDagua && !i.telaComConteudo;
}

const CAMPOS: (keyof ItemGaleria)[] = [
  "arquivo",
  "largura",
  "altura",
  "alt",
  "ambiente",
  "estacao",
  "destaque",
  "ordem",
  "tambemEm",
  "baixaResolucao",
  "excluirDoSite",
  "creditoPendente",
  "marcaDagua",
  "telaComConteudo",
];

const OPCIONAIS: string[] = ["credito", "destaqueMobile", "foco"];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Devolve a lista de problemas do manifesto; vazia quando válido. */
export function validarManifesto(grupo: Grupo, itens: unknown): string[] {
  const erros: string[] = [];
  if (!Array.isArray(itens)) return [`${grupo}: manifesto não é uma lista`];

  const vistos = new Set<string>();
  const ordens = new Set<number>();

  itens.forEach((bruto, i) => {
    const onde = `${grupo}[${i}]`;
    if (!bruto || typeof bruto !== "object") {
      erros.push(`${onde}: não é objeto`);
      return;
    }
    const it = bruto as Record<string, unknown>;

    const chaves = Object.keys(it);
    const faltando = CAMPOS.filter((c) => !chaves.includes(c));
    const sobrando = chaves.filter((c) => !CAMPOS.includes(c as keyof ItemGaleria) && !OPCIONAIS.includes(c));
    if (faltando.length || sobrando.length) {
      erros.push(`${onde}: faltando [${faltando.join(",")}] sobrando [${sobrando.join(",")}]`);
    }
    if ("credito" in it && (typeof it.credito !== "string" || !it.credito.trim())) erros.push(`${onde}: credito vazio`);
    if ("destaqueMobile" in it && typeof it.destaqueMobile !== "boolean") erros.push(`${onde}: destaqueMobile`);
    if ("foco" in it && !["centro", "esquerda", "direita"].includes(it.foco as string)) erros.push(`${onde}: foco`);

    const arq = it.arquivo;
    if (typeof arq !== "string") erros.push(`${onde}: arquivo`);
    else {
      const partes = arq.split("/");
      const nome = partes[partes.length - 1];
      if (partes[0] !== (grupo === "comum" ? "comum" : grupo)) erros.push(`${onde}: fora da pasta ${grupo}`);
      if (!partes.slice(0, -1).every((p) => SLUG.test(p))) erros.push(`${onde}: pasta fora do padrão (${arq})`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*\.(jpg|png)$/.test(nome)) erros.push(`${onde}: nome fora do padrão (${nome})`);
      if (vistos.has(arq)) erros.push(`${onde}: arquivo repetido (${arq})`);
      vistos.add(arq);
    }

    for (const n of ["largura", "altura", "ordem"] as const) {
      if (!Number.isInteger(it[n]) || (it[n] as number) <= 0) erros.push(`${onde}: ${n} inválido`);
    }
    if (typeof it.ordem === "number") {
      if (ordens.has(it.ordem)) erros.push(`${onde}: ordem repetida (${it.ordem})`);
      ordens.add(it.ordem);
    }

    if (typeof it.alt !== "string" || !it.alt.trim()) erros.push(`${onde}: alt vazio`);
    if (typeof it.ambiente !== "string" || !SLUG.test(it.ambiente)) erros.push(`${onde}: ambiente`);
    if (!ESTACOES.includes(it.estacao as Estacao)) erros.push(`${onde}: estacao`);
    for (const b of ["destaque", "baixaResolucao", "excluirDoSite", "creditoPendente", "marcaDagua", "telaComConteudo"] as const) {
      if (typeof it[b] !== "boolean") erros.push(`${onde}: ${b} não é booleano`);
    }
    if (!Array.isArray(it.tambemEm) || !it.tambemEm.every((t) => typeof t === "string" && SLUG.test(t))) {
      erros.push(`${onde}: tambemEm`);
    }
    if (it.destaque === true && !podeSerVitrine(it as ItemGaleria)) {
      erros.push(`${onde}: destaque não pode ser baixa resolução, excluída, com marca d'água ou tela com conteúdo`);
    }
  });

  return erros;
}

/** Itens que o site mostra, na ordem da curadoria. */
export function itensVisiveis(itens: ItemGaleria[]): ItemGaleria[] {
  return itens.filter((i) => !i.excluirDoSite).sort((a, b) => a.ordem - b.ordem);
}
