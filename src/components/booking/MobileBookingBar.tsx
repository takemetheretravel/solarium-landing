"use client";

import { formatBRLPrecise } from "@/lib/cn";

type Props = {
  propertySlug: string;
  minNightly?: number | null;
  propertyName: string;
};

export default function MobileBookingBar({ minNightly, propertyName }: Props) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-charcoal/10 bg-cream shadow-[0_-4px_24px_rgba(0,0,0,0.10)]">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          {minNightly ? (
            <>
              <p className="font-sans text-[0.6rem] uppercase tracking-[0.2em] text-charcoal/55">
                A partir de
              </p>
              <p className="font-serif text-xl text-charcoal">
                {formatBRLPrecise(minNightly)}
                <span className="ml-1 font-sans text-xs text-charcoal/55">/ noite</span>
              </p>
            </>
          ) : (
            <p className="font-serif text-lg text-charcoal">{propertyName}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth" })
          }
          className="flex-shrink-0 bg-copper px-7 py-3 font-sans text-xs uppercase tracking-[0.25em] text-cream hover:bg-copper/90 transition-colors"
        >
          Reservar
        </button>
      </div>
    </div>
  );
}
