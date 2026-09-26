/**
 * Parte leve da biblioteca de galerias, segura para componentes cliente: não
 * importa os manifestos (que ficariam no bundle do navegador).
 */

/** Cor Neblina do manual: fundo enquanto a foto carrega (sem blur). */
export const NEBLINA = "#E9E5E0";

/** URL pública no bucket `galerias`. Cada segmento do caminho é codificado. */
export function urlGaleria(arquivo: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL não definida");
  const caminho = arquivo.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/galerias/${caminho}`;
}
