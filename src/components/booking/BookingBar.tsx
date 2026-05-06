"use client";

import { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Users, ArrowRight } from "lucide-react";

type CombinedDay = {
  date: string;
  anyAvailable: boolean;
  anyArrival: boolean;
  minPrice: number | null;
};

const MAX_DAYS_AHEAD = 540;

function todayPlus(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISO(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function fmtDateBR(d: Date | undefined): string {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";
}

export default function BookingBar() {
  const router = useRouter();
  const [range, setRange] = useState<{ from?: Date; to?: Date }>({});
  const [guests, setGuests] = useState(2);
  const [open, setOpen] = useState<"none" | "dates">("none");
  const [days, setDays] = useState<CombinedDay[]>([]);
  const containerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const start = toISO(todayPlus(0));
    const end = toISO(todayPlus(MAX_DAYS_AHEAD));
    fetch(`/api/calendar/combined?start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.days) setDays(data.days);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen("none");
      }
    }
    if (open !== "none") {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
  }, [open]);

  const { fullyBlockedSet, noArrivalSet } = useMemo(() => {
    const fullyBlockedSet = new Set<string>();
    const noArrivalSet = new Set<string>();
    for (const d of days) {
      if (!d.anyAvailable) fullyBlockedSet.add(d.date);
      else if (!d.anyArrival) noArrivalSet.add(d.date);
    }
    return { fullyBlockedSet, noArrivalSet };
  }, [days]);

  const isChoosingCheckout = Boolean(range.from && !range.to);

  const isDateDisabled = useCallback((date: Date): boolean => {
    const iso = toISO(date);
    const today = toISO(todayPlus(0));
    const maxDate = toISO(todayPlus(MAX_DAYS_AHEAD));
    if (iso < today || iso > maxDate) return true;
    if (fullyBlockedSet.has(iso)) return true;
    if (!isChoosingCheckout) return noArrivalSet.has(iso);
    if (range.from && date <= range.from) return true;
    return false;
  }, [isChoosingCheckout, fullyBlockedSet, noArrivalSet, range.from]);

  const smartDefaultMonth = useMemo(() => {
    if (range.from) return range.from;
    if (days.length === 0) return todayPlus(14);
    for (let i = 0; i < 30; i++) {
      const target = todayPlus(i);
      const iso = toISO(target);
      const day = days.find((d) => d.date === iso);
      if (day?.anyArrival) return target;
    }
    return todayPlus(14);
  }, [days, range.from]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!range.from || !range.to) return;
    const params = new URLSearchParams({
      checkin: toISO(range.from),
      checkout: toISO(range.to),
      guests: String(guests),
    });
    router.push(`/reservar?${params.toString()}`);
  }

  return (
    <form
      ref={containerRef}
      onSubmit={handleSubmit}
      className="relative grid w-full max-w-5xl gap-4 rounded-sm border border-charcoal/10 bg-cream/95 p-6 shadow-2xl shadow-charcoal/10 backdrop-blur sm:grid-cols-[1fr_1fr_auto_auto] sm:gap-6 sm:p-8"
    >
      <button
        type="button"
        onClick={() => setOpen(open === "dates" ? "none" : "dates")}
        className="flex flex-col items-start gap-2 border-b border-charcoal/10 pb-3 text-left sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6"
      >
        <span className="flex items-center gap-2 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-charcoal/60">
          <CalendarDays className="h-3.5 w-3.5" /> Check-in
        </span>
        <span className="font-serif text-lg text-charcoal">
          {range.from ? fmtDateBR(range.from) : "Selecionar"}
        </span>
      </button>

      <button
        type="button"
        onClick={() => setOpen(open === "dates" ? "none" : "dates")}
        className="flex flex-col items-start gap-2 border-b border-charcoal/10 pb-3 text-left sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6"
      >
        <span className="flex items-center gap-2 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-charcoal/60">
          <CalendarDays className="h-3.5 w-3.5" /> Check-out
        </span>
        <span className="font-serif text-lg text-charcoal">
          {range.to ? fmtDateBR(range.to) : "Selecionar"}
        </span>
      </button>

      <label className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-charcoal/60">
          <Users className="h-3.5 w-3.5" /> Hóspedes
        </span>
        <select
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          className="bg-transparent pr-6 font-serif text-lg text-charcoal outline-none focus:text-serra"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "hóspede" : "hóspedes"}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={!range.from || !range.to}
        className="flex items-center justify-center gap-2 bg-copper px-8 py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Verificar
        <ArrowRight className="h-4 w-4" />
      </button>

      {open === "dates" && (
        <div className="absolute left-0 right-0 top-full z-30 mt-3 rounded-sm border border-charcoal/10 bg-cream p-5 shadow-2xl shadow-charcoal/15">
          <div className="rdp-wrapper">
            <DayPicker
              mode="range"
              numberOfMonths={2}
              pagedNavigation
              locale={ptBR}
              defaultMonth={smartDefaultMonth}
              selected={range as { from: Date | undefined; to: Date | undefined }}
              onSelect={(r) => setRange({ from: r?.from, to: r?.to })}
              disabled={isDateDisabled}
              modifiers={{ noArrival: (d: Date) => !fullyBlockedSet.has(toISO(d)) && noArrivalSet.has(toISO(d)) }}
              modifiersClassNames={{ noArrival: "rdp-no-arrival" }}
              weekStartsOn={0}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-charcoal/10 pt-3 font-sans text-[0.65rem] uppercase tracking-[0.2em] text-charcoal/60">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 bg-cream ring-1 ring-charcoal/30" />
              Disponível em ao menos uma casa
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rdp-legend-no-arrival" />
              Só para checkout
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 bg-charcoal/15" />
              Reservado em todas
            </span>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen("none")}
              className="font-sans text-[0.65rem] uppercase tracking-[0.25em] text-copper hover:text-charcoal"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
