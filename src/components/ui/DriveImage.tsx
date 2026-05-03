"use client";

import Image from "next/image";
import { useState } from "react";
import { driveThumbnailUrl } from "@/lib/drive-image";

type Props = {
  fileId: string;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  fill?: boolean;
  width?: number;
  height?: number;
};

export default function DriveImage({
  fileId,
  alt,
  className = "",
  priority = false,
  sizes = "100vw",
  fill = true,
  width,
  height,
}: Props) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`bg-gradient-to-br from-cream via-copper/20 to-serra/30 ${className}`}
        role="img"
        aria-label={alt}
      />
    );
  }

  const src = driveThumbnailUrl(fileId, 1600);

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized
        onError={() => setErrored(true)}
        className={`object-cover ${className}`}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width ?? 1600}
      height={height ?? 1067}
      sizes={sizes}
      priority={priority}
      unoptimized
      onError={() => setErrored(true)}
      className={className}
    />
  );
}
