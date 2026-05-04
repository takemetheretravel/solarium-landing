"use client";

import { Quote } from "lucide-react";
import type { Review } from "@/config/site";

const PROPERTY_LABEL: Record<Review["property"], string> = {
  "solarium-1": "Solarium 1",
  "solarium-2": "Solarium 2",
  "solarium-completo": "Solarium Completo",
};

export default function ReviewsMarquee({ reviews }: { reviews: Review[] }) {
  const loop = [...reviews, ...reviews];
  return (
    <div
      className="solarium-marquee group relative w-full overflow-hidden"
      aria-label="Avaliações dos hóspedes"
    >
      <div className="solarium-marquee-track flex gap-6 group-hover:[animation-play-state:paused]">
        {loop.map((r, i) => (
          <article
            key={`${r.id}-${i}`}
            className="flex w-[320px] flex-shrink-0 flex-col bg-cream p-8 shadow-sm shadow-charcoal/5 sm:w-[380px]"
          >
            <Quote className="h-6 w-6 text-copper" strokeWidth={1.5} />
            <p className="mt-4 line-clamp-6 font-serif text-base italic leading-relaxed text-charcoal/85">
              “{r.text}”
            </p>
            <div className="mt-6 border-t border-charcoal/10 pt-4 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-charcoal/60">
              <span className="text-charcoal">{r.author}</span>
              <span className="mx-2 text-charcoal/30">·</span>
              <span>{r.from}</span>
              <span className="mx-2 text-charcoal/30">·</span>
              <span>{PROPERTY_LABEL[r.property]}</span>
            </div>
          </article>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-cream to-transparent sm:w-24" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-cream to-transparent sm:w-24" />
    </div>
  );
}
