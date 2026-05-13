"use client";

import { useState, useEffect, useRef } from "react";
import { Play, X } from "lucide-react";
import { videoUrl, videoPosterUrl } from "@/lib/cloudinary";

type Props = {
  publicId: string;
  title?: string;
  posterPublicId?: string;
  className?: string;
  orientation?: "landscape" | "portrait";
};

export default function VideoBlock({
  publicId,
  title,
  posterPublicId,
  className,
  orientation = "landscape",
}: Props) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open && videoRef.current) {
      videoRef.current.pause();
    }
  }, [open]);

  const poster = posterPublicId ? videoPosterUrl(posterPublicId) : videoPosterUrl(publicId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative block w-full overflow-hidden bg-charcoal/5 ${className || ""}`}
        aria-label={title ? `Assistir vídeo: ${title}` : "Assistir vídeo"}
      >
        <div
          className={`relative overflow-hidden ${
            orientation === "portrait" ? "aspect-[9/16]" : "aspect-video"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt={title || "Prévia do vídeo"}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 via-transparent to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-cream/95 shadow-2xl backdrop-blur-sm transition-transform group-hover:scale-110">
              <Play className="ml-1 h-7 w-7 fill-charcoal text-charcoal" />
            </div>
          </div>
          {title && (
            <div className="absolute bottom-6 left-6 right-6">
              <p className="font-serif text-xl text-cream drop-shadow-lg md:text-2xl">{title}</p>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-charcoal/95 p-4 md:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-cream/10 text-cream transition-colors hover:bg-cream/20 md:right-6 md:top-6"
            aria-label="Fechar vídeo"
          >
            <X className="h-6 w-6" />
          </button>
          <video
            ref={videoRef}
            src={videoUrl(publicId)}
            controls
            autoPlay
            playsInline
            className={orientation === "portrait" ? "max-h-[85vh] w-auto" : "max-h-full max-w-full"}
          >
            Seu navegador não suporta vídeo HTML5.
          </video>
        </div>
      )}
    </>
  );
}
