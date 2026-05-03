"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Users, ArrowRight } from "lucide-react";

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function BookingBar() {
  const router = useRouter();
  const [checkin, setCheckin] = useState(todayISO(14));
  const [checkout, setCheckout] = useState(todayISO(16));
  const [guests, setGuests] = useState(2);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({ checkin, checkout, guests: String(guests) });
    router.push(`/reservar?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid w-full max-w-5xl gap-4 rounded-sm border border-charcoal/10 bg-cream/95 p-6 shadow-2xl shadow-charcoal/10 backdrop-blur sm:grid-cols-[1fr_1fr_auto_auto] sm:gap-6 sm:p-8"
    >
      <label className="flex flex-col gap-2 border-b border-charcoal/10 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
        <span className="flex items-center gap-2 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-charcoal/60">
          <CalendarDays className="h-3.5 w-3.5" /> Check-in
        </span>
        <input
          type="date"
          value={checkin}
          min={todayISO(0)}
          onChange={(e) => setCheckin(e.target.value)}
          className="bg-transparent font-serif text-lg text-charcoal outline-none focus:text-serra"
        />
      </label>

      <label className="flex flex-col gap-2 border-b border-charcoal/10 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
        <span className="flex items-center gap-2 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-charcoal/60">
          <CalendarDays className="h-3.5 w-3.5" /> Check-out
        </span>
        <input
          type="date"
          value={checkout}
          min={checkin}
          onChange={(e) => setCheckout(e.target.value)}
          className="bg-transparent font-serif text-lg text-charcoal outline-none focus:text-serra"
        />
      </label>

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
        className="flex items-center justify-center gap-2 bg-copper px-8 py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90"
      >
        Verificar
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}
