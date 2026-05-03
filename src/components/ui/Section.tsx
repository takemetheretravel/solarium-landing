import { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
  id?: string;
  spacing?: "default" | "tight" | "loose";
};

const spacings = {
  default: "py-24 md:py-32",
  tight: "py-16 md:py-20",
  loose: "py-32 md:py-44",
};

export default function Section({ children, className, id, spacing = "default" }: Props) {
  return (
    <section id={id} className={cn(spacings[spacing], className)}>
      {children}
    </section>
  );
}
