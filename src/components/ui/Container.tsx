import { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  children: ReactNode;
  className?: string;
  size?: "default" | "narrow" | "wide";
};

const sizes = {
  default: "max-w-7xl",
  narrow: "max-w-3xl",
  wide: "max-w-[88rem]",
};

export default function Container({ children, className, size = "default" }: Props) {
  return (
    <div className={cn("mx-auto w-full px-6 sm:px-10 lg:px-16", sizes[size], className)}>
      {children}
    </div>
  );
}
