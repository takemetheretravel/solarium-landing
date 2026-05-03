import { ReactNode, createElement } from "react";
import { cn } from "@/lib/cn";

type Level = 1 | 2 | 3 | 4;

type Props = {
  level?: Level;
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "div";
};

const sizes: Record<Level, string> = {
  1: "text-5xl sm:text-7xl md:text-8xl tracking-tight leading-[0.95]",
  2: "text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05]",
  3: "text-2xl sm:text-3xl md:text-4xl tracking-tight leading-tight",
  4: "text-xl sm:text-2xl tracking-tight leading-tight",
};

export default function Heading({ level = 2, children, className, as }: Props) {
  const Tag = as ?? (`h${level}` as "h1" | "h2" | "h3" | "h4");
  return createElement(
    Tag,
    {
      className: cn("font-serif font-light text-balance", sizes[level], className),
    },
    children,
  );
}
