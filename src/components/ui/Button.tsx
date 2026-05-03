import Link from "next/link";
import { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "copper";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-sans font-medium tracking-wide transition-all duration-200 rounded-none uppercase text-xs whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-charcoal text-cream hover:bg-serra",
  secondary: "border border-charcoal text-charcoal hover:bg-charcoal hover:text-cream",
  ghost: "text-charcoal hover:text-serra",
  copper: "bg-copper text-cream hover:bg-copper/90",
};

const sizes: Record<Size, string> = {
  md: "px-6 py-3",
  lg: "px-9 py-4 text-sm",
};

type AsButton = { as?: "button" } & ComponentProps<"button">;
type AsLink = { as: "link"; href: string } & Omit<ComponentProps<typeof Link>, "href">;

type Props = (AsButton | AsLink) & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
};

export default function Button(props: Props) {
  const { variant = "primary", size = "md", className, children, ...rest } = props as Props & {
    variant?: Variant;
    size?: Size;
    className?: string;
  };
  const cls = cn(base, variants[variant], sizes[size], className);

  if ((props as AsLink).as === "link") {
    const { href, ...linkRest } = rest as { href: string };
    return (
      <Link href={href} className={cls} {...linkRest}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...(rest as ComponentProps<"button">)}>
      {children}
    </button>
  );
}
