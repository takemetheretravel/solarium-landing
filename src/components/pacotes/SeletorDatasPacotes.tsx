"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Calendar } from "lucide-react";

function isoHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diaSeguinte(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Seletor de datas do topo de /pacotes. Escreve na própria URL; a página lê os
 * parâmetros no servidor e recalcula todos os cards contra a tarifa real.
 *
 * A URL como estado tem um efeito colateral desejado: a busca fica
 * compartilhável e sobrevive ao recarregar.
 */
export default function SeletorDatasPacotes() {
  const router = useRouter();
  const params = useSearchParams();

  const [checkin, setCheckin] = useState(params.get("checkin") ?? "");
  const [checkout, setCheckout] = useState(params.get("checkout") ?? "");
  const [guests, setGuests] = useState(Number(params.get("guests") ?? 2));

  const hoje = isoHoje();

  function aplicar(novo: { checkin?: string; checkout?: string; guests?: number }) {
    const ci = novo.checkin ?? checkin;
    const co = novo.checkout ?? checkout;
    const g = novo.guests ?? guests;

    const q = new URLSearchParams();
    if (ci) q.set("checkin", ci);
    if (co) q.set("checkout", co);
    if (g !== 2) q.set("guests", String(g));

    router.replace(q.toString() ? `/pacotes?${q}` : "/pacotes", { scroll: false });
  }

  function limpar() {
    setCheckin("");
    setCheckout("");
    setGuests(2);
    router.replace("/pacotes", { scroll: false });
  }

  return (
    <div className="mt-10 border border-charcoal/10 bg-white p-5">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-copper" strokeWidth={1.5} />
        <span className="font-sans text-xs uppercase tracking-[0.25em] text-charcoal/70">
          Suas datas
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-xs text-charcoal/60">Check-in</span>
          <input
            type="date"
            value={checkin}
            min={hoje}
            onChange={(e) => {
              const v = e.target.value;
              setCheckin(v);
              // Check-out anterior ao novo check-in deixa de fazer sentido.
              const co = checkout && checkout <= v ? diaSeguinte(v) : checkout;
              setCheckout(co);
              aplicar({ checkin: v, checkout: co });
            }}
            className="border border-charcoal/20 bg-cream px-3 py-2.5 font-sans text-sm text-charcoal"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-xs text-charcoal/60">Check-out</span>
          <input
            type="date"
            value={checkout}
            min={checkin ? diaSeguinte(checkin) : hoje}
            onChange={(e) => {
              setCheckout(e.target.value);
              aplicar({ checkout: e.target.value });
            }}
            className="border border-charcoal/20 bg-cream px-3 py-2.5 font-sans text-sm text-charcoal"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-xs text-charcoal/60">Hóspedes</span>
          <select
            value={guests}
            onChange={(e) => {
              const v = Number(e.target.value);
              setGuests(v);
              aplicar({ guests: v });
            }}
            className="border border-charcoal/20 bg-cream px-3 py-2.5 font-sans text-sm text-charcoal"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(checkin || checkout) && (
        <button
          type="button"
          onClick={limpar}
          className="mt-3 font-sans text-xs uppercase tracking-[0.25em] text-copper hover:text-charcoal"
        >
          Limpar datas
        </button>
      )}
    </div>
  );
}
