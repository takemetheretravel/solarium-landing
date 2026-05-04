"use client";

import { useState } from "react";
import DriveImage from "./DriveImage";

type Props = {
  videoFileId: string;
  fallbackImageId: string;
  alt: string;
  imageObjectPosition?: string;
};

export default function HeroVideo({
  videoFileId,
  fallbackImageId,
  alt,
  imageObjectPosition,
}: Props) {
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = Boolean(videoFileId) && !videoFailed;

  if (showVideo) {
    return (
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onError={() => setVideoFailed(true)}
        poster={`https://drive.google.com/thumbnail?id=${fallbackImageId}&sz=w1600`}
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={`https://drive.google.com/uc?export=download&id=${videoFileId}`} type="video/mp4" />
      </video>
    );
  }

  return (
    <div
      className="absolute inset-0"
      style={imageObjectPosition ? ({ "--hero-pos": imageObjectPosition } as React.CSSProperties) : undefined}
    >
      <DriveImage
        fileId={fallbackImageId}
        alt={alt}
        priority
        sizes="100vw"
        className={imageObjectPosition ? "object-[var(--hero-pos)]" : undefined}
      />
    </div>
  );
}
