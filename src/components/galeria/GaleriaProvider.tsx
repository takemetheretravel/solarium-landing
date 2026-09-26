"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import Lightbox from "./Lightbox";
import type { ItemGaleria } from "@/lib/galerias/manifesto";

type Contexto = { abrir: (arquivo?: string) => void; total: number };

const GaleriaContext = createContext<Contexto | null>(null);

/**
 * Um lightbox por página, compartilhado entre o mosaico e a grade por
 * ambiente. `todas` é a sequência que o lightbox percorre.
 */
export default function GaleriaProvider({ todas, children }: { todas: ItemGaleria[]; children: ReactNode }) {
  const [indice, setIndice] = useState<number | null>(null);

  const abrir = useCallback(
    (arquivo?: string) => {
      const i = arquivo ? todas.findIndex((x) => x.arquivo === arquivo) : 0;
      setIndice(i < 0 ? 0 : i);
    },
    [todas],
  );

  return (
    <GaleriaContext.Provider value={{ abrir, total: todas.length }}>
      {children}
      {indice !== null && (
        <Lightbox itens={todas} indice={indice} onMudar={setIndice} onFechar={() => setIndice(null)} />
      )}
    </GaleriaContext.Provider>
  );
}

export function useGaleria(): Contexto {
  const ctx = useContext(GaleriaContext);
  if (!ctx) throw new Error("useGaleria fora de <GaleriaProvider>");
  return ctx;
}
