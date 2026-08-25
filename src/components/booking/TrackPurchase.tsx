"use client";

import { useEffect } from "react";
import { trackReservaConcluida } from "@/lib/analytics/tracking";
import { pushPurchase, transactionId } from "@/lib/analytics/dataLayer";

/**
 * Empurra o `purchase` para o dataLayer na confirmação.
 *
 * O identificador é o número da reserva Hostaway quando ele já existe, e o
 * UUID do draft enquanto não existe — a mesma regra do funil inteiro e do envio
 * server-side, para que as duas conversões se reconheçam como a mesma.
 *
 * Nenhum pixel é disparado aqui: quem lê o dataLayer é o GTM.
 */
export function TrackPurchase({
  total,
  draftId,
  reservationId,
  // Contexto do experimento de pacotes. Sem estes campos não há como julgar o
  // resultado em 60 dias — ocupação do Completo e noites de seg a qui saem daqui.
  pacoteId,
  pacoteNome,
  noites,
  valorExtras,
  listing,
  listingNome,
  paymentMethod,
}: {
  total: number;
  draftId: string;
  reservationId?: number;
  pacoteId?: string;
  pacoteNome?: string;
  noites?: number;
  valorExtras?: number;
  listing?: string;
  listingNome?: string;
  paymentMethod?: "card" | "pix";
}) {
  useEffect(() => {
    const id = transactionId({ reservationId, draftId });
    const empurrou = pushPurchase({
      transactionId: id,
      value: total,
      items: [
        {
          item_id: pacoteId || listing || draftId,
          item_name: pacoteNome || listingNome || listing || "Estadia",
          price: total,
          quantity: 1,
        },
      ],
      paymentMethod,
      nights: noites,
    });

    // O evento do experimento acompanha o purchase: se a guarda de idempotência
    // barrou um, o outro também não vai.
    if (empurrou && noites !== undefined && listing) {
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
