import Image from "next/image";
import { cn } from "@/lib/cn";

type Props = {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  fill?: boolean;
  width?: number;
  height?: number;
};

export default function SmartImage({
  src,
  alt,
  className,
  priority,
  sizes = "100vw",
  fill = true,
  width,
  height,
}: Props) {
  if (!fill && (width === undefined || height === undefined)) {
    throw new Error("SmartImage: width and height are required when fill=false");
  }

  const isExternal = src.startsWith("http");

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={isExternal}
        className={cn("object-cover", className)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      unoptimized={isExternal}
      className={className}
    />
  );
}
