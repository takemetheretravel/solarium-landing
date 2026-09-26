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

const POSICAO: Record<NonNullable<ItemGaleria["foco"]>, string> = {
  centro: "center",
  esquerda: "left center",
  direita: "right center",
};

/**
 * Miniatura/recorte: preenche o contêiner (`cover`), respeitando o `foco` do
 * manifesto. Otimizada pelo Next (AVIF/WebP, qualidade 75), fundo Neblina
 * enquanto carrega, sem blur. Para a foto inteira use `<ImagemInteira>`.
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
      style={{ backgroundColor: NEBLINA, objectFit: "cover", objectPosition: POSICAO[item.foco ?? "centro"] }}
      className={cn(className)}
    />
  );
}

/**
 * Foto inteira, na proporção real (largura e altura do manifesto, usadas pelo
 * navegador para a proporção), sem corte: `contain` no espaço disponível. Só
 * o lightbox usa.
 */
export function ImagemInteira({
  item,
  alturaMaxima,
  loading = "eager",
}: {
  item: ItemGaleria;
  alturaMaxima: string;
  loading?: "lazy" | "eager";
}) {
  return (
    <Image
      src={urlGaleria(item.arquivo)}
      alt={item.alt}
      width={item.largura}
      height={item.altura}
      sizes="100vw"
      quality={75}
      loading={loading}
      // Ocupa toda a área (largura 100%, altura disponível) e `contain` mostra
      // a foto inteira; a sobra fica com o fundo escuro do lightbox. Com
      // width/height "auto" a foto ficava no tamanho intrínseco (e 0×0 até
      // carregar).
      style={{ objectFit: "contain", width: "100%", height: alturaMaxima, maxWidth: "100%" }}
    />
  );
}
