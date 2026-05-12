"use client";

import { useEffect } from "react";
import { trackPurchase } from "@/lib/tracking";

export function TrackPurchase({ total, draftId }: { total: number; draftId: string }) {
  useEffect(() => {
    trackPurchase({ value: total, currency: "BRL", transactionId: draftId });
  }, []);
  return null;
}
