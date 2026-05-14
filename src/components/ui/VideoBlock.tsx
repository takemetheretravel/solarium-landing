"use client";

import { useEffect, useRef } from "react";
import { videoUrl } from "@/lib/cloudinary";

type Props = {
  publicId: string;
  className?: string;
  /** 'landscape' (16:9) | 'portrait' (9:16). Default: portrait. */
  orientation?: "landscape" | "portrait";
};

export default function VideoBlock({ publicId, className, orientation = "portrait" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pausa quando fora da viewport (economia de bateria/dados)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.play().catch(() => {
              // autoplay bloqueado — ignora silenciosamente
            });
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.25 },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const aspectClass = orientation === "portrait" ? "aspect-[9/16]" : "aspect-video";

  return (
    <div className={`relative overflow-hidden bg-charcoal ${aspectClass} ${className || ""}`}>
      <video
        ref={videoRef}
        src={videoUrl(publicId)}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
