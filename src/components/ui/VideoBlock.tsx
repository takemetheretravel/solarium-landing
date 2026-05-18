"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { videoUrl } from "@/lib/cloudinary";

type Props = {
  publicId: string;
  className?: string;
  /** 'landscape' (16:9) | 'portrait' (9:16). Default: portrait. */
  orientation?: "landscape" | "portrait";
};

export default function VideoBlock({ publicId, className, orientation = "portrait" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.play().catch(() => {});
          } else {
            video.pause();
            video.muted = true;
            setMuted(true);
          }
        });
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

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
      <button
        type="button"
        onClick={toggleMute}
        className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-charcoal/60 text-cream backdrop-blur-sm transition-colors hover:bg-charcoal/80"
        aria-label={muted ? "Ativar som" : "Silenciar"}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
