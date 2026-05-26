"use client";
import { useEffect } from "react";
import { trackViewContent } from "@/lib/tracking";

type Props = {
  propertySlug: string;
  propertyName: string;
  fromPriceNightly: number;
};

export default function TrackViewContent({ propertySlug, propertyName, fromPriceNightly }: Props) {
  useEffect(() => {
    trackViewContent({
      value: fromPriceNightly,
      currency: "BRL",
      contentName: propertyName,
      contentIds: [propertySlug],
    });
  }, []);
  return null;
}
