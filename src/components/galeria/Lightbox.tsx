"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { ImagemInteira } from "./ImagemGaleria";
import type { ItemGaleria } from "@/lib/galerias/manifesto";

type Props = {
  itens: ItemGaleria[];
  indice: number;
  onMudar: (indice: number) => void;
  onFechar: () => void;
};

const SWIPE_MIN = 50;

/** Preto Serra do manual. Opaco: nada da página aparece por trás. */
const PRETO_SERRA = "#111111";

/**
 * Espaço vertical da foto: a tela inteira menos a barra do contador (4rem) e
 * a legenda (até 7rem). A legenda fica abaixo, nunca sobre a foto.
 */
const ALTURA_FOTO = "calc(100dvh - 11rem)";

/** Classe no <body> enquanto aberto: esconde WhatsApp e barra de reserva (globals.css). */
export const CLASSE_BODY = "lightbox-aberto";

/**
 * Tela cheia por cima de tudo (portal no <body>, z-index acima de header,
 * barra de reserva e WhatsApp), foto inteira sem corte, foco preso, Esc
 * fecha, setas e swipe navegam, contador "3 de 28", alt como legenda.
 * Pré-carrega a próxima e a anterior.
 */
export default function Lightbox({ itens, indice, onMudar, onFechar }: Props) {
  const dialogo = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const toqueX = useRef<number | null>(null);
  const [montado, setMontado] = useState(false);
  const total = itens.length;
  const atual = itens[indice];
  const vizinhas = total > 1 ? [itens[(indice + 1) % total], itens[(indice - 1 + total) % total]] : [];

  const anterior = useCallback(() => onMudar((indice - 1 + total) % total), [indice, total, onMudar]);
  const seguinte = useCallback(() => onMudar((indice + 1) % total), [indice, total, onMudar]);

  useEffect(() => setMontado(true), []);

  // Foco entra no diálogo e volta para quem abriu; rolagem da página travada;
  // elementos flutuantes escondidos.
  useEffect(() => {
    if (!montado) return;
    const quemAbriu = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add(CLASSE_BODY);
    return () => {
      document.body.style.overflow = overflow;
      document.body.classList.remove(CLASSE_BODY);
      quemAbriu?.focus?.();
    };
  }, [montado]);

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

  if (!atual || !montado) return null;

  return createPortal(
    <div
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-label="Fotos da casa"
      className="fixed inset-0 z-[2147483000] flex h-[100dvh] flex-col text-cream"
      style={{ backgroundColor: PRETO_SERRA }}
      onTouchStart={(e) => (toqueX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (toqueX.current === null) return;
        const dx = e.changedTouches[0].clientX - toqueX.current;
        toqueX.current = null;
        if (dx > SWIPE_MIN) anterior();
        else if (dx < -SWIPE_MIN) seguinte();
      }}
    >
      <div className="flex h-16 flex-shrink-0 items-center justify-between px-4 sm:px-8">
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

      <div className="relative flex min-h-0 flex-1 flex-col items-center">
        <button
          type="button"
          onClick={anterior}
          aria-label="Foto anterior"
          className="absolute left-1 top-1/2 z-10 hidden -translate-y-1/2 p-2 hover:text-copper sm:left-4 sm:block"
        >
          <ChevronLeft className="h-10 w-10" />
        </button>
        <figure className="flex w-full flex-col items-center px-0 sm:px-20">
          <div className="flex w-full items-center justify-center" style={{ height: ALTURA_FOTO }}>
            <ImagemInteira key={atual.arquivo} item={atual} alturaMaxima={ALTURA_FOTO} />
          </div>
          <figcaption className="max-w-3xl px-4 pt-3 text-center font-sans text-sm leading-relaxed text-cream/80">
            {atual.alt}
            {atual.credito && <span className="mt-1 block text-xs text-cream/50">Foto: {atual.credito}</span>}
          </figcaption>
        </figure>
        <button
          type="button"
          onClick={seguinte}
          aria-label="Próxima foto"
          className="absolute right-1 top-1/2 z-10 hidden -translate-y-1/2 p-2 hover:text-copper sm:right-4 sm:block"
        >
          <ChevronRight className="h-10 w-10" />
        </button>
      </div>

      {/* Pré-carrega a próxima e a anterior: fora da tela, sem ocupar espaço. */}
      <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
        {vizinhas
          .filter((v, i, arr) => v && v.arquivo !== atual.arquivo && arr.findIndex((x) => x.arquivo === v.arquivo) === i)
          .map((v) => (
            <ImagemInteira key={v.arquivo} item={v} alturaMaxima={ALTURA_FOTO} />
          ))}
      </div>
    </div>,
    document.body,
  );
}
