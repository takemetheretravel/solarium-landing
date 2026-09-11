"use client";

import { useMemo } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import {
  criarLoaderCloudinary,
  ehPublicIdCloudinary,
  type RecorteCloudinary,
} from "@/lib/cloudinary";

/*
 * Client component por causa do `loader`.
 *
 * `loader` é uma função, e função não atravessa a fronteira de um Server
 * Component para um Client Component — `next/image` é client, então passar o
 * loader daqui quebrava o build inteiro ("Functions cannot be passed directly
 * to Client Components"). Marcando este arquivo como client, a função é
 * resolvida no mesmo lado e nada precisa ser serializado.
 *
 * A alternativa era registrar o loader global em `next.config.mjs`. Foi
 * descartada: ela mudaria também o `<Image>` cru de
 * `/reservar/[draftId]/pagamento`, que esta rodada não pode tocar.
 *
 * Isto não custa renderização no servidor: o componente continua sendo
 * renderizado no SSR, inclusive o `<link rel="preload">` do `priority`.
 */

type Props = {
  /**
   * Caminho em `/public`, URL absoluta, ou — o caso normal hoje — um publicId
   * do Cloudinary (`solarium/casas/solarium-1/01-...`), que ativa o loader.
   */
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  /**
   * Obrigatório. Sem `sizes`, o Next assume `100vw` e um thumbnail de 200px
   * baixa a variante de 3840px — foi exatamente o que o site fazia. Descreva a
   * largura RENDERIZADA por breakpoint, não a do viewport.
   */
  sizes: string;
  fill?: boolean;
  width?: number;
  height?: number;
  blurDataURL?: string;
  /**
   * Recorta no servidor em vez de deixar tudo para o `object-cover`. Use
   * `RECORTE_HERO` nos heros full-bleed — sem ele, um original em retrato é
   * entregue inteiro para preencher uma faixa larga. Ver `cloudinary.ts`.
   */
  recorte?: RecorteCloudinary;
};

export default function SmartImage({
  src,
  alt,
  className,
  priority,
  sizes,
  fill = true,
  width,
  height,
  blurDataURL,
  recorte,
}: Props) {
  if (!fill && (width === undefined || height === undefined)) {
    throw new Error("SmartImage: width and height are required when fill=false");
  }

  const noCloudinary = ehPublicIdCloudinary(src);
  const ehExterna = src.startsWith("http");

  // Memorizado para o `next/image` não receber uma função nova a cada render.
  const loader = useMemo(
    () => criarLoaderCloudinary(recorte),
    [recorte?.ar, recorte?.maxLargura], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const comuns = {
    src,
    alt,
    sizes,
    priority,
    ...(noCloudinary ? { loader } : {}),
    // URL absoluta que não é publicId continua sem otimização (fotos da
    // Hostaway, por exemplo): o otimizador do Next cobraria uma volta extra
    // por imagem que já vem pronta de outro domínio.
    ...(ehExterna ? { unoptimized: true } : {}),
    ...(blurDataURL ? { placeholder: "blur" as const, blurDataURL } : {}),
  };

  if (fill) {
    return <Image {...comuns} fill className={cn("object-cover", className)} />;
  }

  return <Image {...comuns} width={width} height={height} className={className} />;
}
