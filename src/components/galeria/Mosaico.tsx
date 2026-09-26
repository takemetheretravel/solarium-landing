"use client";

import { Images } from "lucide-react";
import ImagemGaleria from "./ImagemGaleria";
import { useGaleria } from "./GaleriaProvider";
import type { ItemGaleria } from "@/lib/galerias/manifesto";

/**
 * 1 foto grande à esquerda e 4 menores em grade à direita. No celular só a
 * grande aparece, com o botão "Ver as N fotos". Os botões ficam abaixo das
 * fotos: nada de texto sobre a imagem (manual da marca).
 */
export default function Mosaico({ itens }: { itens: ItemGaleria[] }) {
  const { abrir, total } = useGaleria();
  const [grande, ...menores] = itens;
  if (!grande) return null;

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 md:h-[520px] md:grid-cols-4 md:grid-rows-2">
        <button
          type="button"
          onClick={() => abrir(grande.arquivo)}
          className="relative aspect-[4/3] overflow-hidden md:col-span-2 md:row-span-2 md:aspect-auto"
          aria-label={`Ampliar: ${grande.alt}`}
        >
          <ImagemGaleria item={grande} sizes="(min-width: 768px) 50vw, 100vw" className="transition-transform duration-700 hover:scale-[1.02]" />
        </button>
        {menores.slice(0, 4).map((item) => (
          <button
            key={item.arquivo}
            type="button"
            onClick={() => abrir(item.arquivo)}
            className="relative hidden overflow-hidden md:block"
            aria-label={`Ampliar: ${item.alt}`}
          >
            <ImagemGaleria item={item} sizes="(min-width: 768px) 25vw, 1px" className="transition-transform duration-700 hover:scale-[1.02]" />
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => abrir(grande.arquivo)}
          className="inline-flex items-center gap-2 border border-charcoal/20 px-5 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-copper hover:text-copper"
        >
          <Images className="h-4 w-4" strokeWidth={1.5} />
          <span className="md:hidden">Ver as {total} fotos</span>
          <span className="hidden md:inline">Ver todas as fotos</span>
        </button>
      </div>
    </div>
  );
}
