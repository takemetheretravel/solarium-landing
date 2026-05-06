"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { LOGO } from "@/config/site";

const NAV = [
  { href: "/#nossas-casas", label: "Nossas Casas" },
  { href: "/experiencias", label: "Experiências" },
  { href: "/parceiros", label: "Parceiros" },
  { href: "/#contato", label: "Contato" },
];

const HERO_ROUTES = ["/", "/solarium-1", "/solarium-2", "/solarium-completo", "/experiencias", "/parceiros"];

export default function Header() {
  const pathname = usePathname() || "/";
  const hasHero = HERO_ROUTES.includes(pathname);
  const [scrolled, setScrolled] = useState(!hasHero);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasHero) {
      setScrolled(true);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero, pathname]);

  const useDarkLogo = scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        useDarkLogo
          ? "bg-cream/95 backdrop-blur-sm border-b border-charcoal/10"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3 sm:px-10 sm:py-4 lg:px-16">
        <Link
          href="/"
          className="relative block"
          onClick={() => setOpen(false)}
          aria-label="Solarium Mantiqueira — início"
        >
          <Image
            src={useDarkLogo ? LOGO.black : LOGO.white}
            alt="Solarium Mantiqueira"
            width={200}
            height={56}
            priority
            className="h-10 w-auto object-contain md:h-12"
          />
        </Link>

        <nav className="hidden items-center gap-10 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "font-sans text-xs uppercase tracking-[0.2em] transition-colors hover:text-copper",
                scrolled ? "text-charcoal" : "text-cream drop-shadow-sm",
              )}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/#busca"
            className="bg-copper px-6 py-3 font-sans text-xs uppercase tracking-[0.2em] text-cream transition-colors hover:bg-copper/90"
          >
            Reservar
          </Link>
        </nav>

        <button
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "lg:hidden",
            useDarkLogo ? "text-charcoal" : "text-cream",
          )}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <nav className="border-t border-charcoal/10 bg-cream lg:hidden">
          <div className="flex flex-col px-6 py-4 sm:px-10">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-charcoal/5 py-4 font-sans text-sm uppercase tracking-[0.2em] text-charcoal hover:text-copper"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/#busca"
              onClick={() => setOpen(false)}
              className="mt-6 bg-copper px-6 py-4 text-center font-sans text-xs uppercase tracking-[0.2em] text-cream"
            >
              Reservar
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
