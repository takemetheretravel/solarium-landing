"use client";

import { useState } from "react";
import { formatBRLPrecise } from "@/lib/cn";

type Property = { id: number; name: string };

type ApiResult = {
  propertyId: number;
  propertyName: string;
  checkin: string;
  checkout: string;
  guests: number;
  elapsedMs: number;
  approach: string;
  result:
    | {
        quote: {
          totalPrice: number;
          baseTotal: number;
          cleaningFee: number;
          extraGuestFee: number;
          nights: number;
          averageNightly: number;
          currency: string;
          source: string;
        };
      }
    | { failure: { reason: string; message: string; meta?: Record<string, unknown> } };
  rawDays: Array<{ date: string; isAvailable: number; price: number; minimumStay: number }>;
};

function todayPlus(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function PriceTester({ properties, debugKey }: { properties: Property[]; debugKey: string }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? 0);
  const [checkin, setCheckin] = useState(todayPlus(30));
  const [checkout, setCheckout] = useState(todayPlus(33));
  const [guests, setGuests] = useState(2);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResponse(null);
    const url = `/api/debug/price-test?key=${debugKey}&propertyId=${propertyId}&checkin=${checkin}&checkout=${checkout}&guests=${guests}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setResponse(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const requestUrl = `/api/debug/price-test?key=${debugKey}&propertyId=${propertyId}&checkin=${checkin}&checkout=${checkout}&guests=${guests}`;

  return (
    <div className="space-y-4 font-sans text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-charcoal/50">Propriedade</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(Number(e.target.value))}
            className="mt-1 w-full border border-charcoal/20 bg-cream p-2 text-charcoal"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-charcoal/50">Check-in</span>
          <input
            type="date"
            value={checkin}
            onChange={(e) => setCheckin(e.target.value)}
            className="mt-1 w-full border border-charcoal/20 bg-cream p-2 text-charcoal"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-charcoal/50">Check-out</span>
          <input
            type="date"
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
            className="mt-1 w-full border border-charcoal/20 bg-cream p-2 text-charcoal"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-widest text-charcoal/50">Hóspedes</span>
          <input
            type="number"
            min={1}
            max={8}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="mt-1 w-full border border-charcoal/20 bg-cream p-2 text-charcoal"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="border border-charcoal bg-charcoal px-4 py-2 text-xs uppercase tracking-widest text-cream hover:bg-serra disabled:opacity-50"
      >
        {loading ? "Calculando…" : "Calcular preço"}
      </button>

      <div className="border-t border-charcoal/10 pt-4">
        <span className="block text-xs uppercase tracking-widest text-charcoal/50">Request URL</span>
        <code className="mt-1 block break-all bg-charcoal/5 p-2 font-mono text-xs text-charcoal">{requestUrl}</code>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 p-3 text-red-700">{error}</div>
      )}

      {response && (
        <>
          <div className="border-t border-charcoal/10 pt-4">
            <span className="block text-xs uppercase tracking-widest text-charcoal/50">Abordagem</span>
            <code className="mt-1 block bg-charcoal/5 p-2 font-mono text-xs text-charcoal">{response.approach}</code>
            <span className="mt-2 block text-xs text-charcoal/60">
              Tempo: {response.elapsedMs}ms
            </span>
          </div>

          {"quote" in response.result ? (
            <div className="border border-serra/30 bg-serra/5 p-4">
              <p className="text-base font-medium text-serra">✓ Preço calculado com sucesso</p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Total</dt>
                  <dd className="font-serif text-2xl text-charcoal">
                    {formatBRLPrecise(response.result.quote.totalPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Médio / noite</dt>
                  <dd className="font-serif text-2xl text-charcoal">
                    {formatBRLPrecise(response.result.quote.averageNightly)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Subtotal (diárias)</dt>
                  <dd>{formatBRLPrecise(response.result.quote.baseTotal)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Limpeza</dt>
                  <dd>{formatBRLPrecise(response.result.quote.cleaningFee)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Extra hóspedes</dt>
                  <dd>{formatBRLPrecise(response.result.quote.extraGuestFee)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-widest text-charcoal/50">Noites</dt>
                  <dd>{response.result.quote.nights}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="border border-copper/30 bg-copper/5 p-4">
              <p className="text-base font-medium text-copper">
                ⚠ Falha — {response.result.failure.reason}
              </p>
              <p className="mt-1 text-sm text-charcoal/80">{response.result.failure.message}</p>
              {response.result.failure.meta && (
                <pre className="mt-2 overflow-auto bg-cream p-2 font-mono text-xs">
                  {JSON.stringify(response.result.failure.meta, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className="border-t border-charcoal/10 pt-4">
            <span className="block text-xs uppercase tracking-widest text-charcoal/50">Diárias retornadas pelo /calendar</span>
            <pre className="mt-2 max-h-64 overflow-auto bg-charcoal/5 p-3 font-mono text-xs text-charcoal">
{JSON.stringify(
  response.rawDays.map((d) => ({
    date: d.date,
    isAvailable: d.isAvailable,
    price: d.price,
    minimumStay: d.minimumStay,
  })),
  null,
  2,
)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
