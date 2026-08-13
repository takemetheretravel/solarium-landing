"use client";

import { useEffect } from "react";
import { trackPurchase, trackReservaConcluida } from "@/lib/tracking";

export function TrackPurchase({
  total,
  draftId,
  // Contexto do experimento de pacotes. Sem estes campos não há como julgar o
  // resultado em 60 dias — ocupação do Completo e noites de seg a qui saem daqui.
  pacoteId,
  noites,
  valorExtras,
  listing,
}: {
  total: number;
  draftId: string;
  pacoteId?: string;
  noites?: number;
  valorExtras?: number;
  listing?: string;
}) {
  useEffect(() => {
    trackPurchase({ value: total, currency: "BRL", transactionId: draftId });
    if (noites !== undefined && listing) {
      trackReservaConcluida({
        tipo: pacoteId ? "pacote" : "avulso",
        pacoteId,
        total,
        noites,
        valorExtras: valorExtras ?? 0,
        listing,
      });
    }
    // Dispara uma vez por confirmação — o draft não muda depois de pago.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
