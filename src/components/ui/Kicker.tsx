import { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
  tone?: "copper" | "serra" | "cream" | "charcoal";
};

const tones = {
  copper: "text-copper",
  serra: "text-serra",
  cream: "text-cream",
  charcoal: "text-charcoal/70",
};

export default function Kicker({ children, className, tone = "copper" }: Props) {
  return (
    <span
      className={cn(
        "inline-block font-sans text-[0.65rem] uppercase tracking-[0.35em] sm:text-xs",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
