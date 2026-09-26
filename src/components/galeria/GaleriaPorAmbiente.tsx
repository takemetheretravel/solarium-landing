"use client";

import { useState } from "react";
import ImagemGaleria from "./ImagemGaleria";
import { useGaleria } from "./GaleriaProvider";
import type { Categoria } from "@/lib/galerias";
import { cn } from "@/lib/cn";

/**
 * Chips com os ambientes da casa e, abaixo, a grade do ambiente escolhido
 * (3 colunas; 2 no celular). Só o ambiente ativo vai para o DOM. Clique abre
 * o lightbox naquela foto.
 */
export default function GaleriaPorAmbiente({ categorias }: { categorias: Categoria[] }) {
  const { abrir } = useGaleria();
  const [ativa, setAtiva] = useState(categorias[0]?.id);
  const atual = categorias.find((c) => c.id === ativa) ?? categorias[0];
  if (!atual) return null;

  return (
    <div>
      <div className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Ambientes">
        {categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setAtiva(c.id)}
            aria-pressed={c.id === atual.id}
            className={cn(
              "flex-shrink-0 border px-4 py-2 font-sans text-xs uppercase tracking-[0.2em] transition-colors",
              c.id === atual.id
                ? "border-charcoal bg-charcoal text-cream"
                : "border-charcoal/20 text-charcoal/70 hover:border-copper hover:text-copper",
            )}
          >
            {c.rotulo} <span className="opacity-60">· {c.itens.length}</span>
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {atual.itens.map((item) => (
          <li key={item.arquivo}>
            <button
              type="button"
              onClick={() => abrir(item.arquivo)}
              className="relative block aspect-[4/3] w-full overflow-hidden"
              aria-label={`Ampliar: ${item.alt}`}
            >
              <ImagemGaleria
                item={item}
                sizes="(min-width: 1024px) 22vw, (min-width: 768px) 33vw, 50vw"
                className="transition-transform duration-700 hover:scale-[1.03]"
              />
            </button>
            {item.credito && <p className="mt-1 font-sans text-[0.65rem] text-charcoal/50">Foto: {item.credito}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
