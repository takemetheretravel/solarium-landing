"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import SmartImage from "@/components/ui/SmartImage";

type Props = {
  images: string[];
  altPrefix: string;
};

export default function Gallery({ images, altPrefix }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length)),
    [images.length],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % images.length)),
    [images.length],
  );

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [openIndex, close, prev, next]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="relative aspect-[4/3] overflow-hidden bg-charcoal/5 transition-transform hover:scale-[1.02]"
            aria-label={`${altPrefix} - foto ${i + 1}`}
          >
            <SmartImage
              src={src}
              alt={`${altPrefix} - foto ${i + 1}`}
              sizes="(max-width: 768px) 50vw, 25vw"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-charcoal/95">
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="absolute right-6 top-6 text-cream hover:text-copper"
          >
            <X className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={prev}
            aria-label="Anterior"
            className="absolute left-4 text-cream hover:text-copper sm:left-8"
          >
            <ChevronLeft className="h-10 w-10" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Próxima"
            className="absolute right-4 text-cream hover:text-copper sm:right-8"
          >
            <ChevronRight className="h-10 w-10" />
          </button>
          <div className="relative h-[80vh] w-[90vw] max-w-6xl">
            <SmartImage
              src={images[openIndex]}
              alt={`${altPrefix} - foto ${openIndex + 1}`}
              sizes="90vw"
              priority
              className="object-contain"
            />
          </div>
          <span className="absolute bottom-6 font-sans text-xs uppercase tracking-[0.3em] text-cream/70">
            {openIndex + 1} / {images.length}
          </span>
        </div>
      )}
    </>
  );
}
