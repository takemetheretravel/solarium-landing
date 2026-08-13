"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBRL, formatExtraPrice } from "@/lib/cn";
import { JANELA_CANCELAMENTO_EXTRAS_DIAS, type PacoteV2 } from "@/config/precos-e-extras";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import PersonalizeSuaEstadia from "@/components/extras/PersonalizeSuaEstadia";
import {
  trackPacoteVisualizado,
  trackPacoteDatasSelecionadas,
  trackPacoteCtaReserva,
  type OrigemPacote,
} from "@/lib/tracking";

type Item = {
  extraId: string;
  nome: string;
  qtd: number;
  precoUnitario: number;
  total: number;
  entraNaBase: boolean;
  incluso: boolean;
};

type Preco =
  | { compativel: true; total: number; subtotal: number; descontoTotal: number; itens: Item[];
      noites: number; economia: number; bonusAplicado: boolean;
      dataLimiteCancelamentoExtras: string; disponiveis: ExtraExibivel[] }
  | { compativel: false; motivo: string; alternativa: "avulso" | "outro-pacote" | null };

export default function PacoteClient({
  pacote,
  propertySlug,
  origem,
}: {
  pacote: PacoteV2;
  propertySlug: string;
  origem: OrigemPacote;
}) {
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [guests, setGuests] = useState(2);
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [selecao, setSelecao] = useState<Record<string, number>>({});
  const [preco, setPreco] = useState<Preco | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    trackPacoteVisualizado({ pacoteId: pacote.id, origem });
  }, [pacote.id, origem]);

  const recalcular = useCallback(async () => {
    if (!checkin || !checkout) return;
    setCarregando(true);
    try {
      const res = await fetch("/api/pacotes/preco", {
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
      });
      const dados = (await res.json()) as Preco;
      setPreco(dados);
      trackPacoteDatasSelecionadas({
        pacoteId: pacote.id,
        checkin,
        checkout,
        compativel: dados.compativel,
      });
    } catch {
      setPreco({ compativel: false, motivo: "Não foi possível calcular agora.", alternativa: null });
    } finally {
      setCarregando(false);
    }
  }, [checkin, checkout, guests, removidos, selecao, pacote.id, propertySlug]);

  useEffect(() => {
    void recalcular();
  }, [recalcular]);

  const inclusos = pacote.inclusos.map((i) => i.extraId);
  const removiveis = pacote.inclusos.filter((i) => i.removivel);

  return (
    <div className="space-y-10">
      {/* Datas e hóspedes */}
      <section>
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Escolha as datas
        </span>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="font-sans text-xs text-charcoal/60">Chegada</span>
            <input
              type="date"
              value={checkin}
              onChange={(e) => setCheckin(e.target.value)}
              className="mt-1 w-full rounded border border-charcoal/20 px-3 py-2 font-sans text-sm"
            />
          </label>
          <label className="block">
            <span className="font-sans text-xs text-charcoal/60">Saída</span>
            <input
              type="date"
              value={checkout}
              onChange={(e) => setCheckout(e.target.value)}
              className="mt-1 w-full rounded border border-charcoal/20 px-3 py-2 font-sans text-sm"
            />
          </label>
          <label className="block">
            <span className="font-sans text-xs text-charcoal/60">Hóspedes</span>
            <input
              type="number"
              min={1}
              max={6}
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value) || 2)}
              className="mt-1 w-full rounded border border-charcoal/20 px-3 py-2 font-sans text-sm"
            />
          </label>
        </div>
      </section>

      {/* O que está incluso, com os valores cheios de menu visíveis */}
      <section className="border-t border-charcoal/10 pt-8">
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          O que está incluso
        </span>
        <ul className="mt-4 space-y-2">
          {(preco?.compativel ? preco.itens.filter((i) => i.incluso) : []).map((i) => (
            <li key={i.extraId} className="flex items-baseline justify-between gap-3">
              <span className="font-sans text-sm text-charcoal">{i.nome}</span>
              <span className="font-sans text-sm text-charcoal/45">
                {formatExtraPrice(i.total)}
              </span>
            </li>
          ))}
          {!preco?.compativel && (
            <li className="font-sans text-sm text-charcoal/50">
              Escolha as datas para ver os itens e o valor.
            </li>
          )}
        </ul>

        {removiveis.length > 0 && preco?.compativel && (
          <div className="mt-5 space-y-2">
            {removiveis.map((r) => {
              const fora = removidos.includes(r.extraId);
              return (
                <button
                  key={r.extraId}
                  type="button"
                  onClick={() =>
                    setRemovidos((atual) =>
                      fora ? atual.filter((x) => x !== r.extraId) : [...atual, r.extraId],
                    )
                  }
                  className="font-sans text-xs text-copper underline underline-offset-4"
                >
                  {fora ? "Voltar a incluir" : "Não quero"}{" "}
                  {preco.itens.find((i) => i.extraId === r.extraId)?.nome ?? r.extraId}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Resumo de preço — desconto numa linha só, imediatamente antes do total */}
      <section className="border-t border-charcoal/10 pt-8">
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Resumo
        </span>

        {carregando && (
          <p className="mt-4 font-sans text-sm text-charcoal/50">Calculando…</p>
        )}

        {!carregando && preco && !preco.compativel && (
          <div className="mt-4">
            <p className="font-sans text-sm text-charcoal">{preco.motivo}</p>
            <Link
              href={preco.alternativa === "avulso" ? `/${propertySlug}` : "/pacotes"}
              className="mt-2 inline-block font-sans text-xs uppercase tracking-[0.25em] text-copper"
            >
              {preco.alternativa === "avulso" ? "Ver esta casa por noite" : "Ver outros pacotes"}
            </Link>
          </div>
        )}

        {!carregando && preco?.compativel && (
          <>
            <dl className="mt-4 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-sans text-sm text-charcoal">
                  {preco.noites} {preco.noites === 1 ? "noite" : "noites"}
                </dt>
                <dd className="font-sans text-sm text-charcoal/70">
                  {formatExtraPrice(preco.subtotal - preco.itens.reduce((s, i) => s + i.total, 0))}
                </dd>
              </div>
              {preco.itens.map((i) => (
                <div key={i.extraId} className="flex items-baseline justify-between gap-3">
                  <dt className="font-sans text-sm text-charcoal">
                    {i.qtd > 1 ? `${i.qtd}× ` : ""}
                    {i.nome}
                  </dt>
                  <dd className="font-sans text-sm text-charcoal/70">{formatExtraPrice(i.total)}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-charcoal/10 pt-2">
                <dt className="font-sans text-sm text-copper">Desconto do pacote</dt>
                <dd className="font-sans text-sm text-copper">
                  −{formatExtraPrice(preco.descontoTotal)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-charcoal/10 pt-3">
                <dt className="font-serif text-lg text-charcoal">Total</dt>
                <dd className="font-serif text-lg text-charcoal">{formatBRL(preco.total)}</dd>
              </div>
            </dl>

            {preco.economia > 0 && (
              <p className="mt-3 font-sans text-xs text-charcoal/60">
                {formatBRL(preco.economia)} a menos que contratando cada item à parte.
              </p>
            )}
          </>
        )}
      </section>

      {/* Personalize sua estadia */}
      {preco?.compativel && (
        <PersonalizeSuaEstadia
          contexto="pacote"
          disponiveis={preco.disponiveis}
          selecao={selecao}
          onChange={setSelecao}
          inclusos={inclusos.filter((id) => !removidos.includes(id))}
        />
      )}

      {/* CTA */}
      {preco?.compativel && (
        <Link
          href={`/reservar?property=${propertySlug}&checkin=${checkin}&checkout=${checkout}&guests=${guests}&pacote=${pacote.id}`}
          onClick={() =>
            trackPacoteCtaReserva({
              pacoteId: pacote.id,
              total: preco.total,
              bonusAplicado: preco.bonusAplicado,
            })
          }
          className="block rounded bg-charcoal px-6 py-4 text-center font-sans text-sm uppercase tracking-[0.2em] text-cream transition-colors hover:bg-copper"
        >
          Reservar por {formatBRL(preco.total)}
        </Link>
      )}

      {/* Condições */}
      <section className="border-t border-charcoal/10 pt-8">
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Condições
        </span>
        <ul className="mt-4 space-y-3 font-sans text-sm leading-relaxed text-charcoal/70">
          <li>
            Extras têm reembolso integral quando cancelados com{" "}
            {JANELA_CANCELAMENTO_EXTRAS_DIAS} dias ou mais de antecedência da chegada
            {preco?.compativel && (
              <>
                {" "}— para estas datas, até{" "}
                <strong className="text-charcoal">
                  {porExtenso(preco.dataLimiteCancelamentoExtras)}
                </strong>
              </>
            )}
            . Depois disso, o extra não é reembolsado.
          </li>
          <li>
            A decoração precisa ser pedida com 5 dias de antecedência. Cestas e massagem são
            agendadas pelo concierge.
          </li>
          <li>
            O cancelamento da estadia segue a{" "}
            <Link href="/termos#cancelamento" className="text-copper underline underline-offset-4">
              política da reserva
            </Link>
            , que tem prazo próprio.
          </li>
          <li>Este pacote já inclui a melhor condição disponível para estas datas.</li>
        </ul>
      </section>
    </div>
  );
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** A data escrita, não a regra: "14 de setembro". */
function porExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  if (!ano || !mes || !dia) return iso;
  return `${dia} de ${MESES[mes - 1]}`;
}
