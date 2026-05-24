"use client";

import { formatBRLPrecise } from "@/lib/cn";

type Props = {
  fromPriceNightly: number;
  finalTotal: number | null;
  hasDates: boolean;
  onReservarClick: () => void;
};

export default function MobileBookingBar({
  fromPriceNightly,
  finalTotal,
  hasDates,
  onReservarClick,
}: Props) {
  const showTotal = hasDates && finalTotal != null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-charcoal/10 bg-cream shadow-[0_-4px_24px_rgba(0,0,0,0.10)]">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          {showTotal ? (
            <>
              <p className="font-sans text-[0.6rem] uppercase tracking-[0.2em] text-charcoal/55">
                Total
              </p>
              <p className="nums font-serif text-xl text-charcoal">
                {formatBRLPrecise(finalTotal!)}
              </p>
            </>
          ) : (
            <>
              <p className="font-sans text-[0.6rem] uppercase tracking-[0.2em] text-charcoal/55">
                A partir de
              </p>
              <p className="nums font-serif text-xl text-charcoal">
                {formatBRLPrecise(fromPriceNightly)}
                <span className="ml-1 font-sans text-xs text-charcoal/55">/ noite</span>
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onReservarClick}
          className="flex-shrink-0 bg-copper px-7 py-3 font-sans text-xs uppercase tracking-[0.25em] text-cream hover:bg-copper/90 transition-colors"
        >
          Reservar
        </button>
      </div>
    </div>
  );
}
