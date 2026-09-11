import { describe, expect, it } from "vitest";
import {
  LARGURA_MAXIMA_ENTREGUE,
  cloudinaryLoader,
  ehPublicIdCloudinary,
  ogImageUrl,
} from "@/lib/cloudinary";

const PUBLIC_ID = "solarium/casas/solarium-1/01-banheira-por-do-sol";

describe("cloudinaryLoader", () => {
  it("monta a transformação com a largura pedida", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 640 })).toContain("f_auto,q_auto,w_640,c_limit");
  });

  it("aponta para o publicId, sem duplicar barra", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 640 })).toBe(
      `https://res.cloudinary.com/dmfoddfz3/image/upload/f_auto,q_auto,w_640,c_limit/${PUBLIC_ID}`,
    );
  });

  it("respeita a qualidade quando o chamador define uma", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 640, quality: 60 })).toContain("q_60");
  });

  it("limita a largura no teto, para o hero não baixar o original de 4000px", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 3840 })).toContain(
      `w_${LARGURA_MAXIMA_ENTREGUE}`,
    );
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 3840 })).not.toContain("w_3840");
  });

  it("não infla larguras abaixo do teto", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 828 })).toContain("w_828");
  });

  it("usa c_limit, que nunca faz upscale acima do original", () => {
    expect(cloudinaryLoader({ src: PUBLIC_ID, width: 2048 })).toContain("c_limit");
  });
});

describe("ogImageUrl", () => {
  it("entrega 1200x630 em jpg, formato que todo crawler lê", () => {
    const url = ogImageUrl(PUBLIC_ID);
    expect(url).toContain("w_1200,h_630");
    expect(url).toContain("f_jpg");
    expect(url).toContain("c_fill,g_auto");
  });

  it("nunca devolve URL do Google Drive", () => {
    expect(ogImageUrl(PUBLIC_ID)).not.toContain("drive.google.com");
    expect(ogImageUrl(PUBLIC_ID).startsWith("https://res.cloudinary.com/")).toBe(true);
  });
});

describe("ehPublicIdCloudinary", () => {
  it("reconhece publicId", () => {
    expect(ehPublicIdCloudinary(PUBLIC_ID)).toBe(true);
  });

  it("recusa caminho de /public, URL absoluta e data URI", () => {
    expect(ehPublicIdCloudinary("/images/comum/logo-preto.png")).toBe(false);
    expect(ehPublicIdCloudinary("https://res.cloudinary.com/x/y")).toBe(false);
    expect(ehPublicIdCloudinary("data:image/jpeg;base64,AAA")).toBe(false);
  });
});
