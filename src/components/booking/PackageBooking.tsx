"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, MessageCircle } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";
import {
  PackageConfig,
  validatePackageDates,
  extrasTotal,
  packageTotal,
  round10down,
} from "@/config/packages";
import { PROPERTIES } from "@/config/properties";

type Props = { pkg: PackageConfig };

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PackageBooking({ pkg }: Props) {
  const router = useRouter();

  const eligibleProperties = useMemo(
    () => PROPERTIES.filter((p) => pkg.properties.includes(p.slug)),
    [pkg.properties],
  );

  const [propertySlug, setPropertySlug] = useState(eligibleProperties[0]?.slug ?? "");
  const [checkin, setCheckin] = useState("");
  // Extras com opções (mesmo preço): inicia na primeira opção de cada um
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      pkg.extras.filter((e) => e.choices?.length).map((e) => [e.label, e.choices![0].label]),
    ),
  );
  const [dateError, setDateError] = useState<string | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [hostawayTotal, setHostawayTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const todayISO = useMemo(() => isoToday(), []);
  const maxDateISO = useMemo(() => isoPlus(540), []);

  // Checkout derivado: pacote tem número exato de noites
  const checkout = checkin ? isoAddDays(checkin, pkg.nights) : "";

  const extras = extrasTotal(pkg);

  useEffect(() => {
    setDateError(null);
    setAvailError(null);
    setPriceError(null);
    setHostawayTotal(null);
    if (!checkin || !propertySlug) return;

    const co = isoAddDays(checkin, pkg.nights);
    const v = validatePackageDates(pkg, checkin, co);
    if (!v.valid) {
      setDateError(v.reason);
      return;
    }

    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const [availRes, priceRes] = await Promise.all([
          fetch("/api/availability/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propertyId: propertySlug, checkin, checkout: co, guests: 2 }),
            signal: ctrl.signal,
          }),
          fetch(
            `/api/price?${new URLSearchParams({ property: propertySlug, checkin, checkout: co, guests: "2", payment: "card" }).toString()}`,
            { signal: ctrl.signal },
          ),
        ]);
        const avail = await availRes.json();
        const price = await priceRes.json();

        if (!avail.available) {
          setAvailError("Estas datas não estão disponíveis nesta casa. Tente outras datas ou outra casa.");
          setLoading(false);
          return;
        }
        if (price.ok !== true) {
          setPriceError(price.failure?.message || "Não foi possível calcular o preço para essas datas.");
          setLoading(false);
          return;
        }
        setHostawayTotal(price.hostawayTotal as number);
        setLoading(false);
      } catch {
        if (!ctrl.signal.aborted) {
          setPriceError("Erro ao verificar as datas. Tente novamente.");
          setLoading(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, propertySlug, pkg.slug]);

  const isShortNotice = Boolean(
    checkin && checkin < new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  );

  const total = hostawayTotal != null ? packageTotal(pkg, hostawayTotal) : null;
  const stayDiscounted =
    hostawayTotal != null ? round10down(hostawayTotal * (1 - pkg.stayDiscountPct / 100)) : null;
  const aLaCarte = hostawayTotal != null ? hostawayTotal + extras : null;
  const pixTotal = total != null ? total * 0.97 : null;
  const canReserve = Boolean(total != null && !loading && !dateError && !availError && !priceError);

  function handleReserve() {
    if (!canReserve || !checkin) return;
    const params = new URLSearchParams({
      propertyId: propertySlug,
      checkin,
      checkout,
      guests: "2",
      package: pkg.slug,
    });
    const chosen = Object.values(selectedChoices);
    if (chosen.length > 0) params.set("choices", chosen.join("|"));
    router.push(`/reservar?${params.toString()}`);
  }

  return (
    <div className="rounded-sm border border-charcoal/10 bg-cream p-6 shadow-xl shadow-charcoal/5 sm:p-8">
      <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
        Reserve o pacote
      </span>

      {/* CASA */}
      <div className="mt-5 border-t border-charcoal/10 pt-4">
        <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
          Casa
        </span>
        <div className="mt-2 flex gap-2">
          {eligibleProperties.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => setPropertySlug(p.slug)}
              className={`flex-1 border px-3 py-2 font-sans text-xs uppercase tracking-widest transition-all ${
                propertySlug === p.slug
                  ? "border-charcoal bg-charcoal text-cream"
                  : "border-charcoal/20 text-charcoal hover:border-charcoal/40"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* DATAS */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-charcoal/10 py-4">
        <div>
          <label htmlFor="pkg-checkin" className="block cursor-pointer font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Check-in
          </label>
          <div className="relative mt-1">
            <input
              id="pkg-checkin"
              type="date"
              value={checkin}
              min={todayISO}
              max={maxDateISO}
              onChange={(e) => setCheckin(e.target.value)}
              className="w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 pr-8 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
            <Calendar className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/40" />
          </div>
        </div>
        <div>
          <label className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Check-out ({pkg.nights} noites)
          </label>
          <input
            type="date"
            value={checkout}
            disabled
            readOnly
            className="mt-1 w-full border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none opacity-70"
          />
        </div>
      </div>

      {isShortNotice && (
        <p className="mt-2 font-sans text-xs leading-relaxed text-copper">
          Para datas tão próximas, recomendamos reservar com pelo menos 3 dias de
          antecedência — assim garantimos cada detalhe com nossos parceiros. Sua
          reserva será confirmada normalmente e nosso concierge entrará em contato
          para alinhar as entregas.
        </p>
      )}

      {/* EXTRAS COM ESCOLHA (mesmo preço — não altera o total) */}
      {pkg.extras.filter((e) => e.choices?.length).map((extra) => (
        <div key={extra.label} className="mt-4 border-t border-charcoal/10 pt-4">
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            {extra.label}
          </span>
          <div className="mt-2 flex gap-2">
            {extra.choices!.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() =>
                  setSelectedChoices((prev) => ({ ...prev, [extra.label]: c.label }))
                }
                className={`flex-1 border px-3 py-2 font-sans text-xs uppercase tracking-widest transition-all ${
                  selectedChoices[extra.label] === c.label
                    ? "border-charcoal bg-charcoal text-cream"
                    : "border-charcoal/20 text-charcoal hover:border-charcoal/40"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {dateError && <p className="mt-3 font-sans text-xs text-copper">{dateError}</p>}
      {availError && (
        <div className="mt-3 border border-copper/30 bg-copper/5 p-3">
          <p className="font-sans text-xs text-charcoal">{availError}</p>
        </div>
      )}
      {priceError && <p className="mt-3 font-sans text-xs text-copper">{priceError}</p>}
      {loading && <p className="mt-3 font-sans text-xs text-charcoal/50">Verificando datas e calculando…</p>}

      {/* TRANSPARÊNCIA DE VALOR */}
      <div className="mt-6 space-y-2 font-sans text-sm">
        <p className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
          O que compõe o valor
        </p>
        <div className="flex justify-between text-charcoal/80">
          <span>Estadia ({pkg.nights} noites)</span>
          <span>
            {hostawayTotal != null ? formatBRLPrecise(hostawayTotal) : "conforme as datas"}
          </span>
        </div>
        {pkg.extras.map((e) => (
          <div key={e.label} className="flex justify-between gap-4 text-charcoal/80">
            <span>{e.label}{e.perNight ? ` ×${pkg.nights}` : ""}</span>
            <span className="flex-shrink-0">{formatBRLPrecise(e.price * (e.perNight ? pkg.nights : 1))}</span>
          </div>
        ))}
        {aLaCarte != null && total != null && aLaCarte > total && (
          <div className="flex justify-between text-charcoal/50">
            <span>Valor à la carte</span>
            <span className="line-through">{formatBRLPrecise(aLaCarte)}</span>
          </div>
        )}
        {stayDiscounted != null && hostawayTotal != null && pkg.stayDiscountPct > 0 && (
          <div className="flex justify-between text-serra">
            <span>Estadia no pacote (−{pkg.stayDiscountPct}%)</span>
            <span>{formatBRLPrecise(stayDiscounted)}</span>
          </div>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t border-charcoal/10 pt-3 font-serif">
          <span className="text-base uppercase tracking-widest text-charcoal/70">Total do pacote</span>
          <span className="text-3xl text-charcoal">
            {total != null ? formatBRLPrecise(total) : "—"}
          </span>
        </div>
        {total != null && pixTotal != null && (
          <p className="text-right font-sans text-xs text-charcoal/60">
            em até 6x sem juros · ou {formatBRLPrecise(pixTotal)} no Pix
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleReserve}
        disabled={!canReserve}
        className="mt-6 flex w-full items-center justify-center gap-2 bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reservar pacote
        <ArrowRight className="h-4 w-4" />
      </button>

      <a
        href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Tenho interesse no pacote ${pkg.name}.`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal/20 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
      >
        <MessageCircle className="h-4 w-4" /> Falar com o concierge
      </a>
    </div>
  );
}
