import { z } from "zod";
import type { PropertySlug } from "@/config/properties";
import solarium1 from "../../content/galerias/solarium-1.json";
import solarium2 from "../../content/galerias/solarium-2.json";
import solariumCompleto from "../../content/galerias/solarium-completo.json";

/**
 * Schema dos manifestos de galeria.
 *
 * Os JSONs em `content/galerias/` são GERADOS (`npm run galeria:sync`) a partir
 * do Cloudinary. Este arquivo é a fronteira onde o dado gerado vira dado
 * confiável: o `parse` roda no escopo do módulo, então um manifesto inválido
 * explode no `next build` e nunca chega a produção como galeria quebrada.
 *
 * Não editar os JSONs à mão, com uma exceção deliberada: o campo `ordem`, que
 * o gerador preserva justamente para permitir recurar a sequência sem perder o
 * trabalho no próximo sync.
 */

export const AMBIENTES = [
  "vista",
  "spa",
  "cinema",
  "quarto",
  "cozinha",
  "sala",
  "externa",
  "amanhecer",
  "conjunto",
] as const;

export const ESTACOES = ["verde", "seca", "indiferente"] as const;

export type Ambiente = (typeof AMBIENTES)[number];
export type Estacao = (typeof ESTACOES)[number];

const fotoSchema = z.object({
  id: z.string().min(1),
  publicId: z.string().min(1),
  /** Texto alternativo real, vindo de `context.alt` no Cloudinary. Vazio não passa. */
  alt: z.string().min(3),
  ambiente: z.enum(AMBIENTES),
  estacao: z.enum(ESTACOES),
  largura: z.number().int().positive(),
  altura: z.number().int().positive(),
  ordem: z.number().int().positive(),
  destaque: z.boolean(),
  /**
   * Miniatura borrada embutida (`e_blur:1000,q_1,w_20`). Opcional para o schema
   * não quebrar num manifesto antigo, mas o gerador sempre preenche.
   */
  blurDataURL: z.string().startsWith("data:image/").optional(),
});

const manifestoSchema = z
  .object({
    casa: z.string().min(1),
    geradoPor: z.string().optional(),
    fotos: z.array(fotoSchema).min(1),
  })
  .refine(
    (m) => new Set(m.fotos.map((f) => f.id)).size === m.fotos.length,
    "ids repetidos no manifesto",
  )
  .refine(
    (m) => new Set(m.fotos.map((f) => f.ordem)).size === m.fotos.length,
    "campo 'ordem' repetido — a sequência da galeria ficaria ambígua",
  );

export type Foto = z.infer<typeof fotoSchema>;
export type Manifesto = z.infer<typeof manifestoSchema>;

/** Exportado para os testes exercitarem o schema com entrada inválida. */
export function validarManifesto(entrada: unknown, origem: string): Manifesto {
  const r = manifestoSchema.safeParse(entrada);
  if (!r.success) {
    const detalhes = r.error.issues
      .map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Manifesto de galeria inválido em ${origem}:\n${detalhes}`);
  }
  return r.data;
}

const MANIFESTOS: Record<PropertySlug, Manifesto> = {
  "solarium-1": validarManifesto(solarium1, "content/galerias/solarium-1.json"),
  "solarium-2": validarManifesto(solarium2, "content/galerias/solarium-2.json"),
  "solarium-completo": validarManifesto(
    solariumCompleto,
    "content/galerias/solarium-completo.json",
  ),
};

/** Fotos da casa, já na ordem de exibição. */
export function fotosDaCasa(casa: PropertySlug): Foto[] {
  return [...MANIFESTOS[casa].fotos].sort((a, b) => a.ordem - b.ordem);
}

/** Uma foto específica pelo `id` do deep-link. */
export function fotoPorId(casa: PropertySlug, id: string): Foto | undefined {
  return MANIFESTOS[casa].fotos.find((f) => f.id === id);
}

export const MANIFESTOS_POR_CASA = MANIFESTOS;
