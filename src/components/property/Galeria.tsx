import { fotosDaCasa } from "@/config/galeria";
import type { PropertySlug } from "@/config/properties";
import GaleriaClient from "./GaleriaClient";

type Props = {
  casa: PropertySlug;
  /**
   * Faixa de 5 miniaturas em vez do mosaico + botão. Para reuso fora da página
   * da casa, onde a galeria é um aperitivo e não a seção principal.
   */
  compacto?: boolean;
  /** Rótulo de origem nos eventos de analytics. */
  origem?: string;
};

/**
 * Galeria de uma casa.
 *
 * Server component de propósito: o manifesto é validado por zod no servidor e
 * só as fotos atravessam para o cliente. Colocar o zod no bundle do browser
 * seria pagar peso em toda página de casa para validar um JSON que já foi
 * validado no build.
 */
export default function Galeria({ casa, compacto = false, origem }: Props) {
  const fotos = fotosDaCasa(casa);
  return (
    <GaleriaClient
      casa={casa}
      fotos={fotos}
      compacto={compacto}
      origem={origem ?? (compacto ? "previa" : "galeria")}
    />
  );
}
