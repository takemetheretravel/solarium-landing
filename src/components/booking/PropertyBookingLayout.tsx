"use client";

import { ReactNode, useCallback, useState } from "react";
import BookingForm from "./BookingForm";
import MobileBookingBar from "./MobileBookingBar";
import Container from "@/components/ui/Container";

type BarInfo = { finalTotal: number | null; hasDates: boolean };

type Props = {
  propertySlug: string;
  propertyName: string;
  fromPriceNightly: number;
  maxCapacity: number;
  idealCapacity?: number;
  initialCheckin?: string;
  initialCheckout?: string;
  initialGuests?: number;
  /** Conteúdo da coluna esquerda (vídeo, galeria, descrição, comodidades, reviews, cancelamento). */
  children: ReactNode;
};

export default function PropertyBookingLayout({
  propertySlug,
  propertyName,
  fromPriceNightly,
  maxCapacity,
  idealCapacity,
  initialCheckin,
  initialCheckout,
  initialGuests,
  children,
}: Props) {
  // Fonte única da verdade para a barra mobile — preenchido pelo BookingForm via onTotalChange.
  const [barInfo, setBarInfo] = useState<BarInfo>({ finalTotal: null, hasDates: false });

  const scrollToMobileForm = useCallback(() => {
    document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <Container size="wide">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] lg:gap-16">

          {/* ── COLUNA ESQUERDA — conteúdo + form inline mobile ── */}
          <div className="min-w-0">
            {children}

            {/* BookingForm inline (mobile-only). É a instância que `#reservar` e a barra
                fixa rolam até. Reporta total via onTotalChange. */}
            <div className="border-t border-charcoal/10 py-10 lg:hidden">
              <BookingForm
                anchorId="reservar"
                propertySlug={propertySlug}
                initialCheckin={initialCheckin}
                initialCheckout={initialCheckout}
                initialGuests={initialGuests}
                maxCapacity={maxCapacity}
                idealCapacity={idealCapacity}
                onTotalChange={setBarInfo}
              />
            </div>
          </div>

          {/* ── COLUNA DIREITA — sticky desktop ── */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 py-12">
              <BookingForm
                anchorId="reservar-desktop"
                propertySlug={propertySlug}
                initialCheckin={initialCheckin}
                initialCheckout={initialCheckout}
                initialGuests={initialGuests}
                maxCapacity={maxCapacity}
                idealCapacity={idealCapacity}
                onTotalChange={setBarInfo}
              />
            </div>
          </aside>

        </div>
      </Container>

      {/* Barra fixa mobile — escuta barInfo do BookingForm */}
      <MobileBookingBar
        fromPriceNightly={fromPriceNightly}
        finalTotal={barInfo.finalTotal}
        hasDates={barInfo.hasDates}
        onReservarClick={scrollToMobileForm}
      />

      {/* Sufixo: o nome da casa é props-only por enquanto, mas mantido na API para
          futura exibição (ex.: prop title na barra). */}
      <span className="sr-only">{propertyName}</span>
    </>
  );
}
