const CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || "dmfoddfz3";
const BASE_URL = `https://res.cloudinary.com/${CLOUD_NAME}`;

export function videoUrl(publicId: string, format: "mp4" | "webm" = "mp4"): string {
  return `${BASE_URL}/video/upload/q_auto/${publicId}.${format}`;
}

export function videoPosterUrl(
  publicId: string,
  opts?: { width?: number; height?: number },
): string {
  const w = opts?.width || 1600;
  const h = opts?.height || 900;
  return `${BASE_URL}/video/upload/w_${w},h_${h},c_fill,q_auto,f_jpg/${publicId}.jpg`;
}

export function imageUrl(
  publicId: string,
  opts?: { width?: number; height?: number; quality?: "auto" | number; version?: number },
): string {
  const w = opts?.width;
  const h = opts?.height;
  const q = opts?.quality || "auto";
  const transforms = [
    "f_auto",
    `q_${q}`,
    w ? `w_${w}` : "",
    h ? `h_${h}` : "",
    w || h ? "c_fill" : "",
  ]
    .filter(Boolean)
    .join(",");
  const versionPart = opts?.version ? `v${opts.version}/` : "";
  return `${BASE_URL}/image/upload/${transforms}/${versionPart}${publicId}`;
}

/**
 * Loader do `next/image` para assets do Cloudinary.
 *
 * Existe porque a alternativa que o site usava era `unoptimized`: toda imagem
 * externa saía do Cloudinary no tamanho original, e um thumbnail de 200px
 * baixava o mesmo arquivo que o hero. Com o loader, o Next monta o `srcset` e
 * cada largura vira uma transformação — o Cloudinary entrega o recorte certo.
 *
 * `c_limit` e não `c_fill`: o loader recebe largura, nunca altura, então
 * recortar aqui seria decidir enquadramento no escuro. Proporção é do arquivo;
 * o recorte visual fica no CSS (`object-cover`), que sabe a caixa real.
 *
 * NÃO registrar como loader global em `next.config.mjs`: os logos ainda são
 * servidos de `/public` e passariam por aqui como se fossem publicId.
 */
export const LARGURA_MAXIMA_ENTREGUE = 2048;

/** Heros full-bleed: ver `criarLoaderCloudinary`. */
export const RECORTE_HERO = { ar: "4:3", maxLargura: 1200 } as const;

export type RecorteCloudinary = { ar: string; maxLargura?: number };

/**
 * Fabrica um loader do `next/image` para assets do Cloudinary.
 *
 * O teto de largura mora AQUI, e não em `sizes`, porque `sizes` descreve a
 * largura do layout e o browser ainda multiplica pelo devicePixelRatio antes de
 * escolher no `srcset`. Num hero `100vw`, uma tela de 1366 a dpr 1.5 já pede a
 * variante de 1920. Também não mora em `images.deviceSizes`: aquilo é global e
 * mudaria o `srcset` de `/reservar/[draftId]/pagamento`, fora do escopo.
 *
 * Sem `recorte`, usa `c_limit`: o loader só recebe largura, nunca altura, então
 * recortar seria decidir enquadramento no escuro. A proporção fica a do
 * arquivo e o recorte visual é do CSS (`object-cover`), que sabe a caixa real.
 *
 * COM `recorte`, o corte é feito no servidor. Isso existe para os heros
 * full-bleed, onde `c_limit` é caro de um jeito que não aparece: o original do
 * Solarium 2 é um retrato de 3000x4000, e entregá-lo inteiro a 1920 de largura
 * custa 586KB para preencher uma faixa que o CSS já ia cortar — 4x o peso da
 * versão recortada, em bytes que o hóspede baixa e nunca vê.
 */
export function criarLoaderCloudinary(recorte?: RecorteCloudinary) {
  const teto = recorte?.maxLargura ?? LARGURA_MAXIMA_ENTREGUE;
  return function loader({
    src,
    width,
    quality,
  }: {
    src: string;
    width: number;
    quality?: number;
  }): string {
    const largura = Math.min(width, teto);
    const transformacoes = [
      "f_auto",
      `q_${quality ?? "auto"}`,
      `w_${largura}`,
      ...(recorte ? [`ar_${recorte.ar}`, "c_fill"] : ["c_limit"]),
    ].join(",");
    return `${BASE_URL}/image/upload/${transformacoes}/${src}`;
  };
}

export const cloudinaryLoader = criarLoaderCloudinary();

/**
 * Imagem para og:image / twitter:image.
 *
 * 1200x630 fixo e `f_jpg` explícito: os crawlers de rede social não negociam
 * formato como um browser, e vários simplesmente ignoram um `f_auto` que volte
 * AVIF. Formato garantido vale mais que os bytes economizados aqui.
 */
export function ogImageUrl(publicId: string): string {
  return `${BASE_URL}/image/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/${publicId}`;
}

/** `true` para um publicId do Cloudinary — nem URL absoluta, nem caminho de `/public`. */
export function ehPublicIdCloudinary(src: string): boolean {
  return !src.startsWith("http") && !src.startsWith("/") && !src.startsWith("data:");
}
