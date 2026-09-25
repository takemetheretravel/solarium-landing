import Image from "next/image";
import { NEBLINA, urlGaleria } from "@/lib/galerias/url";
import type { ItemGaleria } from "@/lib/galerias/manifesto";
import { cn } from "@/lib/cn";

type Props = {
  item: ItemGaleria;
  /** Obrigatório: sem ele o celular baixa a versão de 3840px. */
  sizes: string;
  priority?: boolean;
  className?: string;
  loading?: "lazy" | "eager";
};

/**
 * Foto do manifesto, otimizada pelo Next (AVIF/WebP, qualidade 75), com fundo
 * Neblina enquanto carrega — sem blur. Sempre `fill`: o contêiner define o
 * enquadramento.
 */
export default function ImagemGaleria({ item, sizes, priority, className, loading }: Props) {
  return (
    <Image
      src={urlGaleria(item.arquivo)}
      alt={item.alt}
      fill
      sizes={sizes}
      quality={75}
      priority={priority}
      loading={priority ? undefined : loading}
      style={{ backgroundColor: NEBLINA }}
      className={cn("object-cover", className)}
    />
  );
}
