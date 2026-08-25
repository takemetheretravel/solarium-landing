"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, MessageCircle, X } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";
import { pushViewPackage } from "@/lib/analytics/dataLayer";
import {
  PackageConfig,
  validatePackageDates,
  round10down,
} from "@/config/packages";
import { PROPERTIES } from "@/config/properties";
import { pacotesV2Ativo } from "@/config/flags";
import ExtrasNaCasa, { serializarSelecao } from "@/components/extras/ExtrasNaCasa";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import PackageBookingV2, { type DatasIniciais } from "@/components/booking/PackageBookingV2";
import type { PacoteV2 } from "@/config/precos-e-extras";

type Props = {
  pkg: PackageConfig | null;
  pacoteV2?: PacoteV2 | null;
  iniciais?: DatasIniciais;
};

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

export default function PackageBooking({ pkg, pacoteV2, iniciais }: Props) {
  // Motor novo tem cartão próprio, com hóspedes e extras. Mesma estrutura visual.
  if (pacoteV2) return <PackageBookingV2 pacote={pacoteV2} iniciais={iniciais} />;
  if (!pkg) return null;
  return <PackageBookingLegado pkg={pkg} />;
}

function PackageBookingLegado({ pkg }: { pkg: PackageConfig }) {
  const router = useRouter();

  const eligibleProperties = useMemo(
    () => PROPERTIES.filter((p) => pkg.properties.includes(p.slug)),
    [pkg.properties],
  );

  const [propertySlug, setPropertySlug] = useState(eligibleProperties[0]?.slug ?? "");
  const [checkin, setCheckin] = useState("");
  const [guests, setGuests] = useState(2);
  const [selecaoExtras, setSelecaoExtras] = useState<Record<string, number>>({});
  // Preço vem do servidor, junto da lista de extras. Nunca recalculado aqui.
  const [disponiveis, setDisponiveis] = useState<ExtraExibivel[]>([]);
  // Extras com opções (mesmo preço): inicia na primeira opção de cada um
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      pkg.extras.filter((e) => e.choices?.length).map((e) => [e.label, e.choices![0].label]),
    ),
  );
  // Extras removidos pelo cliente (só os removable podem entrar aqui)
  const [removedExtras, setRemovedExtras] = useState<string[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [hostawayTotal, setHostawayTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const V2 = pacotesV2Ativo();
  const capacidadeMax =
    eligibleProperties.find((p) => p.slug === propertySlug)?.capacity.max ?? 4;
  // O pacote já traz café: esconder as cestas evita oferecer duplicata.
  const idsDeCafe = useMemo(
    () => (pkg.extras.some((e) => /café da manhã|cesta de café/i.test(e.label))
      ? ["cesta_cafecafe", "cesta_diluia", "cesta_dani"]
      : []),
    [pkg.extras],
  );

  function precoUnitarioExtra(id: string): number | undefined {
    return disponiveis.find((d) => d.extra.id === id)?.precoUnitario;
  }
  function nomeExtra(id: string): string {
    return disponiveis.find((d) => d.extra.id === id)?.extra.nome ?? id;
  }

  const todayISO = useMemo(() => isoToday(), []);
  const maxDateISO = useMemo(() => isoPlus(540), []);

  // Checkout derivado: pacote tem número exato de noites
  const checkout = checkin ? isoAddDays(checkin, pkg.nights) : "";

  function toggleExtra(label: string) {
    setRemovedExtras((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  const extrasAtivos = pkg.extras.filter((e) => !removedExtras.includes(e.label));
  const extrasRemovidos = pkg.extras.filter((e) => e.removable && removedExtras.includes(e.label));
  const extrasAtivosTotal = extrasAtivos.reduce(
    (sum, e) => sum + e.price * (e.perNight ? pkg.nights : 1),
    0,
  );

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
            body: JSON.stringify({ propertyId: propertySlug, checkin, checkout: co, guests }),
            signal: ctrl.signal,
          }),
          fetch(
            `/api/price?${new URLSearchParams({ property: propertySlug, checkin, checkout: co, guests: String(guests), payment: "card" }).toString()}`,
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
  }, [checkin, propertySlug, pkg.slug, guests]);

  const isShortNotice = Boolean(
    checkin && checkin < new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  );

  const hasDates = hostawayTotal != null;
  const canReserve = Boolean(hasDates && !loading && !dateError && !availError && !priceError);

  // Preço que não pôde ser obtido NÃO vira preço aproximado.
  //
  // A queda da API deixava `hostawayTotal` nulo, o cálculo caía no proxy
  // (diária "a partir de" × noites) e a página exibia esse número como se
  // fosse o total real — com a página respondendo 200. Aqui a indisponibilidade
  // é explícita: nenhum valor numérico é renderizado e o cliente vai para o
  // WhatsApp.
  const precoIndisponivel = Boolean(priceError);

  // Componentes pelo valor CHEIO; o desconto aparece só na diferença riscado → total.
  // Sem datas, usa fromPriceNightly × noites como proxy da estadia.
  const selectedProperty =
    eligibleProperties.find((p) => p.slug === propertySlug) ?? eligibleProperties[0];
  const proxyStay = (selectedProperty?.fromPriceNightly ?? 0) * pkg.nights;
  const estadiaCheia = hostawayTotal ?? proxyStay;
  const extrasOpcionaisTotal = Object.entries(selecaoExtras).reduce(
    (soma, [id, qtd]) => soma + (precoUnitarioExtra(id) ?? 0) * qtd,
    0,
  );
  const valorALaCarte = estadiaCheia + extrasAtivosTotal + extrasOpcionaisTotal;
  // Extras opcionais entram DEPOIS do desconto de estadia, igual ao draft:
  // `finalTotal = total do pacote + extras de serviço`. Fórmula do pacote intacta.
  const totalPacote =
    round10down(estadiaCheia * (1 - pkg.stayDiscountPct / 100)) +
    extrasAtivosTotal +
    extrasOpcionaisTotal;
  const pixValue = Math.floor((totalPacote * 0.97) / 10) * 10;

  // view_package só sai com preço REAL na mão. Um evento com `value` derivado do
  // proxy contaria receita que ninguém cotou.
  const viewEnviadoRef = useRef(false);
  useEffect(() => {
    if (viewEnviadoRef.current) return;
    if (precoIndisponivel || hostawayTotal == null) return;
    viewEnviadoRef.current = true;
    pushViewPackage({
      // Ainda não existe reserva nem draft nesta etapa: o identificador canônico
      // só nasce quando o draft é criado, no envio do formulário de hóspede.
      transactionId: "",
      value: totalPacote,
      items: [{ item_id: pkg.slug, item_name: pkg.name, price: totalPacote, quantity: 1 }],
      origem: "pacote",
    });
  }, [precoIndisponivel, hostawayTotal, totalPacote, pkg.slug, pkg.name]);

  function handleReserve() {
    if (!canReserve || !checkin) return;
    const params = new URLSearchParams({
      propertyId: propertySlug,
      checkin,
      checkout,
      guests: String(guests),
      package: pkg.slug,
    });
    const chosen = Object.values(selectedChoices);
    if (chosen.length > 0) params.set("choices", chosen.join("|"));
    // Só envia a lista de extras ativos se algo foi removido; senão o server mantém tudo.
    // ("pkgExtras" — o param "extras" é dos extras de serviço no /reservar)
    if (removedExtras.length > 0) {
      params.set("pkgExtras", extrasAtivos.map((e) => e.label).join("|"));
    }
    const extras = serializarSelecao(selecaoExtras);
    if (extras) params.set("extras", extras);
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

      {/* HÓSPEDES — o valor do hóspede adicional vem da Hostaway, dentro da estadia.
          Faz parte da paridade V2: com a flag desligada o cartão segue fixo em 2. */}
      {V2 && (
      <div className="mt-4 border-b border-charcoal/10 pb-4">
        <label
          htmlFor={`pkg-guests-${pkg.slug}`}
          className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60"
        >
          Hóspedes
        </label>
        <select
          id={`pkg-guests-${pkg.slug}`}
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          className="mt-1 w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none focus:border-copper"
        >
          {Array.from({ length: capacidadeMax }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "hóspede" : "hóspedes"}
            </option>
          ))}
        </select>
      </div>
      )}

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
      {precoIndisponivel && (
        <div className="mt-3 border border-copper/30 bg-copper/5 p-3">
          <p className="font-sans text-xs text-charcoal">
            Não conseguimos calcular o valor destas datas agora. Nosso concierge confirma o preço e a
            disponibilidade para você em instantes.
          </p>
          <a
            href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Quero o pacote ${pkg.name}${checkin ? ` a partir de ${checkin}` : ""} e o site não conseguiu calcular o valor. Pode me passar o preço?`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-sans text-xs text-copper underline"
          >
            Falar com o concierge no WhatsApp
          </a>
        </div>
      )}
      {loading && <p className="mt-3 font-sans text-xs text-charcoal/50">Verificando datas e calculando…</p>}

      {/* PERSONALIZE SUA ESTADIA — mesmo componente e mesma posição dos demais */}
      {V2 && hasDates && (
        <div className="mt-5 border-b border-charcoal/10 pb-5">
          <ExtrasNaCasa
            propertySlug={propertySlug}
            checkin={checkin}
            checkout={checkout}
            contexto="pacote"
            selecao={selecaoExtras}
            onChange={setSelecaoExtras}
            recolhivel={false}
            ocultarIds={idsDeCafe}
            onDisponiveis={setDisponiveis}
          />
        </div>
      )}

      {/* TRANSPARÊNCIA DE VALOR */}
      <div className="mt-6 space-y-3 font-sans text-sm">
        {/* Componentes pelo valor CHEIO (sem desconto) */}
        <div className="flex justify-between text-charcoal/70">
          <span>Estadia ({pkg.nights} noites)</span>
          <span>
            {precoIndisponivel
              ? "sob consulta"
              : hasDates
                ? formatBRLPrecise(estadiaCheia)
                : "conforme as datas"}
          </span>
        </div>
        {extrasAtivos.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-2 text-charcoal/70">
            <span className="flex items-center gap-2">
              {e.label}{e.perNight ? ` ×${pkg.nights}` : ""}
              {e.removable && (
                <button
                  onClick={() => toggleExtra(e.label)}
                  aria-label={`Remover ${e.label}`}
                  className="text-charcoal/35 transition-colors hover:text-charcoal"
                  title="Remover do pacote"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
            <span className="flex-shrink-0">{formatBRLPrecise(e.price * (e.perNight ? pkg.nights : 1))}</span>
          </div>
        ))}
        {/* Extras removidos: linha discreta para readicionar */}
        {extrasRemovidos.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-2 text-charcoal/35">
            <span className="line-through">{e.label}</span>
            <button onClick={() => toggleExtra(e.label)} className="font-sans text-xs uppercase tracking-widest text-copper">
              Adicionar
            </button>
          </div>
        ))}

        {Object.entries(selecaoExtras)
          .filter(([, qtd]) => qtd > 0)
          .map(([id, qtd]) => (
            <div key={id} className="flex items-center justify-between gap-2 text-charcoal/70">
              <span>
                {nomeExtra(id)}
                {qtd > 1 ? ` ×${qtd}` : ""}
              </span>
              <span className="flex-shrink-0">
                {formatBRLPrecise((precoUnitarioExtra(id) ?? 0) * qtd)}
              </span>
            </div>
          ))}

        {precoIndisponivel ? (
          <div className="flex justify-between border-t border-charcoal/10 pt-3 text-charcoal/60">
            <span>Total do pacote</span>
            <span className="font-serif">valor sob consulta</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between border-t border-charcoal/10 pt-3 text-charcoal/50">
              <span>Valor total</span>
              <span className="line-through">{formatBRLPrecise(valorALaCarte)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">Total do pacote</span>
              <span className="font-serif text-3xl text-charcoal">{formatBRLPrecise(totalPacote)}</span>
            </div>
            <p className="text-right font-sans text-xs text-charcoal/50">
              em até 6x sem juros · ou {formatBRLPrecise(pixValue)} no Pix
            </p>
          </>
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
