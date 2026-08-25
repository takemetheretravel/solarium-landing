"use client";
import { useEffect } from "react";
import { pushViewItem } from "@/lib/analytics/dataLayer";

type Props = {
  propertySlug: string;
  propertyName: string;
  fromPriceNightly: number;
};

export default function TrackViewContent({ propertySlug, propertyName, fromPriceNightly }: Props) {
  useEffect(() => {
    pushViewItem({
      itemId: propertySlug,
      itemName: propertyName,
      value: fromPriceNightly,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
