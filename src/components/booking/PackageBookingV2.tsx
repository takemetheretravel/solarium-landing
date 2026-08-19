"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, MessageCircle, X } from "lucide-react";
import { formatBRLPrecise } from "@/lib/cn";
import { PROPERTIES } from "@/config/properties";
import { getExtra, type PacoteV2 } from "@/config/precos-e-extras";
import PersonalizeSuaEstadia from "@/components/extras/PersonalizeSuaEstadia";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import { checkoutSugerido } from "@/lib/pricing/elegibilidade";
import { trackPacoteDatasSelecionadas, trackPacoteCtaReserva } from "@/lib/tracking";

type ItemPrecoApi = { extraId: string; nome: string; total: number; qtd: number; incluso: boolean };

type Resposta =
  | {
      compativel: true;
      total: number;
      itens: ItemPrecoApi[];
      noites: number;
      economia: number;
      bonusAplicado: boolean;
      disponiveis: ExtraExibivel[];
      hostawayTotal: number;
      subtotal: number;
      absorvido: number;
    }
  | { compativel: false; motivo: string; alternativa?: string | null };

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoHoje(): string {
  return iso(new Date());
}
function isoMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return iso(d);
}
function somaDias(base: string, dias: number): string {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return iso(d);
}

/**
 * Cartão de reserva dos pacotes no motor novo.
 *
 * Mesma estrutura visual do cartão que já está em produção — casa, datas, linhas
 * de preço, âncora riscada, total, parcelamento e os dois CTAs. O que muda é o
 * miolo: seletor de hóspedes e bloco de extras entre as datas e o preço, e o
 * total vindo do recálculo server-side.
 */
/** Valores vindos do link personalizado, já validados no servidor. */
export type DatasIniciais = {
  checkin?: string;
  checkout?: string;
  casa?: string;
  guests?: number;
};

export default function PackageBookingV2({
  pacote,
  iniciais,
}: {
  pacote: PacoteV2;
  iniciais?: DatasIniciais;
}) {
  const router = useRouter();

  const casasElegiveis = useMemo(
    () => PROPERTIES.filter((p) => pacote.properties.includes(p.slug)),
    [pacote.properties],
  );

  const duracaoFixa = pacote.noitesMax === pacote.noitesMin;

  // O link personalizado chega como prop, ja validado no servidor. Nada de
  // `useSearchParams` aqui: o hook obriga <Suspense> acima e, sem ele, o Next
  // derruba a pagina inteira com BAILOUT_TO_CLIENT_SIDE_RENDERING.
  const casaDaUrl = casasElegiveis.find((p) => p.slug === iniciais?.casa)?.slug;

  const [propertySlug, setPropertySlug] = useState(
    casaDaUrl ?? casasElegiveis[0]?.slug ?? "",
  );
  const [checkin, setCheckin] = useState(iniciais?.checkin ?? "");
  const [checkout, setCheckout] = useState(iniciais?.checkout ?? "");
  const [guests, setGuests] = useState(() => {
    const min = pacote.hospedesMin ?? 2;
    const n = iniciais?.guests;
    return typeof n === "number" && n >= min ? n : min;
  });
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [selecao, setSelecao] = useState<Record<string, number>>({});
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const hojeISO = useMemo(() => isoHoje(), []);
  const maxISO = useMemo(() => isoMais(540), []);

  // Duração fixa: o check-out acompanha o check-in e não é editável.
  // Duração variável: sugere a saída pela REGRA do pacote — somar as noites
  // mínimas caía em dia que o próprio pacote recusa.
  useEffect(() => {
    if (!checkin) return;
    if (duracaoFixa) {
      setCheckout(somaDias(checkin, pacote.noitesMin));
      return;
    }
    if (!checkout || checkout <= checkin) {
      setCheckout(checkoutSugerido(pacote.slug, checkin) ?? somaDias(checkin, pacote.noitesMin));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, duracaoFixa, pacote.noitesMin, pacote.slug]);

  const capacidadeCasa = casasElegiveis.find((p) => p.slug === propertySlug)?.capacity.max ?? 4;
  const hospedesMin = pacote.hospedesMin ?? 1;
  const hospedesMax = Math.min(pacote.hospedesMax ?? capacidadeCasa, capacidadeCasa);
  const opcoesHospedes = Array.from(
    { length: Math.max(1, hospedesMax - hospedesMin + 1) },
    (_, i) => hospedesMin + i,
  );

  useEffect(() => {
    if (!checkin || !checkout || !propertySlug || checkin >= checkout) {
      setResposta(null);
      return;
    }
    setCarregando(true);
    setErro(null);

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/pacotes/preco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pacoteId: pacote.id,
            propertySlug,
            checkin,
            checkout,
            guests,
            removidos,
            selecaoExtras: selecao,
          }),
          signal: ctrl.signal,
        });
        const d = (await r.json()) as Resposta;
        setResposta(d);
        trackPacoteDatasSelecionadas({
          pacoteId: pacote.id,
          checkin,
          checkout,
          compativel: d.compativel,
        });
      } catch {
        if (!ctrl.signal.aborted) setErro("Erro ao calcular. Tente novamente.");
      } finally {
        if (!ctrl.signal.aborted) setCarregando(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [pacote.id, propertySlug, checkin, checkout, guests, removidos, selecao]);

  const ok = resposta?.compativel === true ? resposta : null;
  const incompativel = resposta?.compativel === false ? resposta : null;
  const podeReservar = Boolean(ok && !carregando && !erro);

  // O riscado é a soma literal das linhas exibidas, calculada no servidor.
  // Nunca recompor aqui — divergir da soma é o bug que a §1 veio matar.
  const valorTotal = ok ? ok.subtotal : null;
  const pix = ok ? Math.floor((ok.total * 0.97) / 10) * 10 : null;

  function alternarRemovido(extraId: string) {
    setRemovidos((prev) =>
      prev.includes(extraId) ? prev.filter((x) => x !== extraId) : [...prev, extraId],
    );
  }

  function reservar() {
    if (!podeReservar || !ok) return;
    trackPacoteCtaReserva({ pacoteId: pacote.id, total: ok.total, bonusAplicado: ok.bonusAplicado });

    const params = new URLSearchParams({
      propertyId: propertySlug,
      checkin,
      checkout,
      guests: String(guests),
      pacote: pacote.id,
    });
    if (removidos.length > 0) params.set("removidos", removidos.join(","));
    const extras = Object.entries(selecao)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => (q === 1 ? id : `${id}:${q}`))
      .join(",");
    if (extras) params.set("extras", extras);

    router.push(`/reservar?${params.toString()}`);
  }

  // Só os inclusos que sobreviveram à remoção. Um item removido deixa de ser
  // "incluso no pacote" e volta a ser item normal, com o preço à frente.
  const inclusosIds = pacote.inclusos
    .map((i) => i.extraId)
    .filter((id) => !removidos.includes(id));

  // Só os itens marcados como removíveis no catálogo ganham o "x".
  function ehRemovivel(extraId: string): boolean {
    return pacote.inclusos.some((i) => i.extraId === extraId && i.removivel);
  }

  return (
    <div className="rounded-sm border border-charcoal/10 bg-cream p-6 shadow-xl shadow-charcoal/5 sm:p-8">
      <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
        Reserve o pacote
      </span>

      {/* CASA — Dois Casais é sempre o Completo, não há o que escolher */}
      {casasElegiveis.length > 1 && (
        <div className="mt-5 border-t border-charcoal/10 pt-4">
          <span className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Casa
          </span>
          <div className="mt-2 flex gap-2">
            {casasElegiveis.map((p) => (
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
      )}

      {/* DATAS */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-charcoal/10 py-4">
        <div>
          <label
            htmlFor="pkg2-checkin"
            className="block cursor-pointer font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60"
          >
            Check-in
          </label>
          <div className="relative mt-1">
            <input
              id="pkg2-checkin"
              type="date"
              value={checkin}
              min={hojeISO}
              max={maxISO}
              onChange={(e) => setCheckin(e.target.value)}
              className="w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 pr-8 font-serif text-lg text-charcoal outline-none focus:border-copper"
            />
            <Calendar className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/40" />
          </div>
        </div>
        <div>
          <label className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Check-out{duracaoFixa ? ` (${pacote.noitesMin} noites)` : ""}
          </label>
          <input
            type="date"
            value={checkout}
            min={checkin ? somaDias(checkin, pacote.noitesMin) : hojeISO}
            max={maxISO}
            disabled={duracaoFixa}
            readOnly={duracaoFixa}
            onChange={(e) => setCheckout(e.target.value)}
            className={`mt-1 w-full border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none ${
              duracaoFixa ? "opacity-70" : "cursor-pointer focus:border-copper"
            }`}
          />
        </div>
      </div>

      {/* HÓSPEDES — o valor de pessoa adicional vem da Hostaway, dentro da estadia */}
      <div className="mt-4 border-b border-charcoal/10 pb-4">
        <label
          htmlFor="pkg2-guests"
          className="block font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60"
        >
          Hóspedes
        </label>
        <select
          id="pkg2-guests"
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
          className="mt-1 w-full cursor-pointer border-b border-charcoal/10 bg-transparent py-1 font-serif text-lg text-charcoal outline-none focus:border-copper"
        >
          {opcoesHospedes.map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "hóspede" : "hóspedes"}
            </option>
          ))}
        </select>
      </div>

      {incompativel && (
        <div className="mt-4 border border-copper/30 bg-copper/5 p-3">
          <p className="font-sans text-xs leading-relaxed text-charcoal">{incompativel.motivo}</p>
          {incompativel.alternativa && (
            <a
              href={incompativel.alternativa}
              className="mt-2 inline-block font-sans text-xs uppercase tracking-[0.2em] text-copper"
            >
              Ver alternativa
            </a>
          )}
        </div>
      )}
      {erro && <p className="mt-3 font-sans text-xs text-copper">{erro}</p>}
      {carregando && (
        <p className="mt-3 font-sans text-xs text-charcoal/50">Verificando datas e calculando…</p>
      )}

      {/* EXTRAS — entre as datas e o preço, aberto assim que há datas */}
      {ok && ok.disponiveis.length > 0 && (
        <div className="mt-5 border-b border-charcoal/10 pb-5">
          <PersonalizeSuaEstadia
            contexto="pacote"
            disponiveis={ok.disponiveis}
            selecao={selecao}
            onChange={setSelecao}
            inclusos={inclusosIds}
          />
        </div>
      )}

      {/* LINHAS DE PREÇO */}
      <div className="mt-6 space-y-3 font-sans text-sm">
        <div className="flex justify-between text-charcoal/70">
          <span>Estadia ({ok?.noites ?? pacote.noitesMin} noites)</span>
          <span>
            {ok ? formatBRLPrecise(ok.hostawayTotal - ok.absorvido) : "conforme as datas"}
          </span>
        </div>

        {/* Hóspedes absorvidos: aparecem cobrados e voltam inteiros no desconto */}
        {ok && ok.absorvido > 0 && (
          <div className="flex justify-between text-charcoal/70">
            <span>Hóspedes adicionais</span>
            <span>{formatBRLPrecise(ok.absorvido)}</span>
          </div>
        )}

        {ok?.itens
          .filter((i) => i.extraId !== "hospedagem")
          .map((i) => (
            <div key={i.extraId} className="flex items-center justify-between gap-2 text-charcoal/70">
              <span className="flex items-center gap-2">
                {i.nome}
                {i.qtd > 1 ? ` ×${i.qtd}` : ""}
                {ehRemovivel(i.extraId) && (
                  <button
                    onClick={() => alternarRemovido(i.extraId)}
                    aria-label={`Remover ${i.nome}`}
                    title="Remover do pacote"
                    className="text-charcoal/35 transition-colors hover:text-charcoal"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
              <span className="flex-shrink-0">{formatBRLPrecise(i.total)}</span>
            </div>
          ))}

        {/* Itens removidos: linha discreta para readicionar */}
        {removidos.map((id) => {
          const incluso = pacote.inclusos.find((i) => i.extraId === id);
          if (!incluso) return null;
          // Nome de exibição, sempre. Nenhum id de catálogo pode vazar para a tela.
          const nome = getExtra(id)?.nome ?? id;
          return (
            <div key={id} className="flex items-center justify-between gap-2 text-charcoal/35">
              <span className="line-through">{nome}</span>
              <button
                onClick={() => alternarRemovido(id)}
                className="font-sans text-xs uppercase tracking-widest text-copper"
              >
                Adicionar
              </button>
            </div>
          );
        })}

        <div className="flex justify-between border-t border-charcoal/10 pt-3 text-charcoal/50">
          <span>Valor total</span>
          <span className="line-through">
            {valorTotal !== null ? formatBRLPrecise(valorTotal) : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-sans text-[0.6rem] uppercase tracking-[0.25em] text-charcoal/60">
            Total do pacote
          </span>
          <span className="font-serif text-3xl text-charcoal">
            {ok ? formatBRLPrecise(ok.total) : "—"}
          </span>
        </div>
        {ok && ok.economia > 0 && (
          <p className="text-right font-sans text-xs text-serra">
            {formatBRLPrecise(ok.economia)} a menos que contratando cada item à parte
          </p>
        )}
        {pix !== null && (
          <p className="text-right font-sans text-xs text-charcoal/50">
            em até 6x sem juros · ou {formatBRLPrecise(pix)} no Pix
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={reservar}
        disabled={!podeReservar}
        className="mt-6 flex w-full items-center justify-center gap-2 bg-copper py-4 font-sans text-xs uppercase tracking-[0.25em] text-cream transition-colors hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reservar pacote
        <ArrowRight className="h-4 w-4" />
      </button>

      <a
        href={`https://wa.me/5535984075652?text=${encodeURIComponent(`Olá! Tenho interesse no pacote ${pacote.nome}.`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal/20 py-3 font-sans text-xs uppercase tracking-[0.25em] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-cream"
      >
        <MessageCircle className="h-4 w-4" /> Falar com o concierge
      </a>
    </div>
  );
}
