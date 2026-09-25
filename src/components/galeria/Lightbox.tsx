"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import ImagemGaleria from "./ImagemGaleria";
import type { ItemGaleria } from "@/lib/galerias/manifesto";

type Props = {
  itens: ItemGaleria[];
  indice: number;
  onMudar: (indice: number) => void;
  onFechar: () => void;
};

const SWIPE_MIN = 50;

/**
 * Tela cheia, foco preso, Esc fecha, setas e swipe navegam, contador "3 de 28",
 * alt como legenda abaixo da foto. Pré-carrega a próxima.
 */
export default function Lightbox({ itens, indice, onMudar, onFechar }: Props) {
  const dialogo = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const toqueX = useRef<number | null>(null);
  const total = itens.length;
  const atual = itens[indice];
  const proxima = itens[(indice + 1) % total];

  const anterior = useCallback(() => onMudar((indice - 1 + total) % total), [indice, total, onMudar]);
  const seguinte = useCallback(() => onMudar((indice + 1) % total), [indice, total, onMudar]);

  // Foco entra no diálogo e volta para quem abriu; rolagem da página travada.
  useEffect(() => {
    const quemAbriu = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      quemAbriu?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      else if (e.key === "ArrowLeft") anterior();
      else if (e.key === "ArrowRight") seguinte();
      else if (e.key === "Tab" && dialogo.current) {
        const focaveis = Array.from(dialogo.current.querySelectorAll<HTMLElement>("button"));
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anterior, seguinte, onFechar]);

  if (!atual) return null;

  return (
    <div
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-label="Fotos da casa"
      className="fixed inset-0 z-[60] flex flex-col bg-charcoal/95 text-cream"
      onTouchStart={(e) => (toqueX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (toqueX.current === null) return;
        const dx = e.changedTouches[0].clientX - toqueX.current;
        toqueX.current = null;
        if (dx > SWIPE_MIN) anterior();
        else if (dx < -SWIPE_MIN) seguinte();
      }}
    >
      <div className="flex items-center justify-between px-4 py-4 sm:px-8">
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-cream/70" aria-live="polite">
          {indice + 1} de {total}
        </span>
        <button
          ref={fechar}
          type="button"
          onClick={onFechar}
          aria-label="Fechar galeria"
          className="p-2 hover:text-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
        >
          <X className="h-7 w-7" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-2 sm:px-16">
        <button
          type="button"
          onClick={anterior}
          aria-label="Foto anterior"
          className="absolute left-1 z-10 hidden p-2 hover:text-copper sm:left-4 sm:block"
        >
          <ChevronLeft className="h-10 w-10" />
        </button>
        <figure className="flex h-full w-full max-w-6xl flex-col">
          <div className="relative min-h-0 flex-1">
            <ImagemGaleria key={atual.arquivo} item={atual} sizes="100vw" className="object-contain" loading="eager" />
          </div>
          <figcaption className="mx-auto max-w-3xl px-4 pb-6 pt-4 text-center font-sans text-sm leading-relaxed text-cream/80">
            {atual.alt}
            {atual.credito && <span className="mt-1 block text-xs text-cream/50">Foto: {atual.credito}</span>}
          </figcaption>
        </figure>
        <button
          type="button"
          onClick={seguinte}
          aria-label="Próxima foto"
          className="absolute right-1 z-10 hidden p-2 hover:text-copper sm:right-4 sm:block"
        >
          <ChevronRight className="h-10 w-10" />
        </button>
      </div>

      {/* Pré-carrega a próxima: fora da tela, sem ocupar espaço. */}
      {proxima && proxima !== atual && (
        <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
          <div className="relative h-screen w-screen">
            <ImagemGaleria item={proxima} sizes="100vw" loading="eager" />
          </div>
        </div>
      )}
    </div>
  );
}
