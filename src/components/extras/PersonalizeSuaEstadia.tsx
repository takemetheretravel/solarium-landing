"use client";

import { useMemo, useState } from "react";
import { formatExtraPrice } from "@/lib/cn";
import { ROTULO_UNIDADE, JANELA_CANCELAMENTO_EXTRAS_DIAS } from "@/config/precos-e-extras";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import { trackExtraSelecionado, trackExtraRemovido, type ContextoExtra } from "@/lib/tracking";

export type PersonalizeProps = {
  /** Onde o bloco está renderizado — muda o rótulo e o evento de analytics. */
  contexto: ContextoExtra;
  /** Já filtrados por noite adjacente livre e antecedência mínima. */
  disponiveis: ExtraExibivel[];
  /** Quantidades atuais, por id de extra. */
  selecao: Record<string, number>;
  onChange: (selecao: Record<string, number>) => void;
  /** Recolhido por padrão na página da casa; aberto no pacote e no checkout. */
  recolhivel?: boolean;
  /** Ids já inclusos no pacote — exibidos como marcados e não somados de novo. */
  inclusos?: string[];
};

export default function PersonalizeSuaEstadia({
  contexto,
  disponiveis,
  selecao,
  onChange,
  recolhivel = false,
  inclusos = [],
}: PersonalizeProps) {
  const [aberto, setAberto] = useState(!recolhivel);

  const algumNaoReembolsavel = useMemo(
    () => disponiveis.some((d) => d.naoReembolsavel && (selecao[d.extra.id] ?? 0) > 0),
    [disponiveis, selecao],
  );

  function definirQtd(id: string, qtd: number, maxQtd: number) {
    const novo = Math.max(0, Math.min(qtd, maxQtd));
    const anterior = selecao[id] ?? 0;
    if (novo === anterior) return;

    if (novo > 0) trackExtraSelecionado({ extraId: id, contexto, qtd: novo });
    else trackExtraRemovido({ extraId: id, contexto });

    const proximo = { ...selecao };
    if (novo === 0) delete proximo[id];
    else proximo[id] = novo;
    onChange(proximo);
  }

  if (disponiveis.length === 0) return null;

  return (
    <section className="border-t border-charcoal/10 pt-8">
      <button
        type="button"
        onClick={() => recolhivel && setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`flex w-full items-center justify-between gap-3 text-left ${recolhivel ? "" : "cursor-default"}`}
      >
        <span className="block font-sans text-[0.65rem] uppercase tracking-[0.3em] text-copper">
          Personalize sua estadia {recolhivel && "(opcional)"}
        </span>
        {recolhivel && (
          <span aria-hidden className="font-sans text-lg text-charcoal/40">
            {aberto ? "−" : "+"}
          </span>
        )}
      </button>

      {aberto && (
        <div className="mt-5 space-y-1">
          {disponiveis.map(({ extra, precoUnitario, naoReembolsavel, maxQtd }) => {
            const qtd = selecao[extra.id] ?? 0;
            const jaIncluso = inclusos.includes(extra.id);
            const informativo = extra.informativo === true;
            const onOff = extra.controle === "on_off";

            return (
              <div
                key={extra.id}
                className="flex items-start justify-between gap-3 border-b border-charcoal/5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm text-charcoal">
                    {extra.nome}
                    {jaIncluso && (
                      <span className="ml-2 font-sans text-xs text-copper">incluso no pacote</span>
                    )}
                  </p>
                  <p className="font-sans text-xs text-charcoal/45">
                    {informativo ? (
                      extra.observacao
                    ) : (
                      <>
                        {formatExtraPrice(precoUnitario)} · {ROTULO_UNIDADE[extra.unidade]}
                      </>
                    )}
                  </p>
                  {!informativo && extra.observacao && qtd > 0 && (
                    <p className="mt-0.5 font-sans text-xs text-copper">{extra.observacao}</p>
                  )}
                  {naoReembolsavel && qtd > 0 && !jaIncluso && (
                    <p className="mt-1 font-sans text-xs text-charcoal/70">
                      Contratado dentro do prazo de {JANELA_CANCELAMENTO_EXTRAS_DIAS} dias: não
                      reembolsável.
                    </p>
                  )}
                </div>

                {!informativo && !jaIncluso && (
                  <div className="flex shrink-0 items-center gap-3">
                    {qtd > 0 && !onOff && (
                      <span className="font-serif text-sm text-charcoal/70">
                        {formatExtraPrice(precoUnitario * qtd)}
                      </span>
                    )}
                    {onOff ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={qtd > 0}
                        aria-label={extra.nome}
                        onClick={() => definirQtd(extra.id, qtd > 0 ? 0 : 1, 1)}
                        className={`h-7 min-w-[3.25rem] rounded-full border px-3 font-sans text-xs transition-colors ${
                          qtd > 0
                            ? "border-copper bg-copper text-cream"
                            : "border-charcoal/20 text-charcoal/60 hover:border-charcoal"
                        }`}
                      >
                        {qtd > 0 ? "incluído" : "add"}
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => definirQtd(extra.id, qtd - 1, maxQtd)}
                          disabled={qtd === 0}
                          aria-label={`Remover ${extra.nome}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-charcoal/20 text-charcoal/70 transition-colors hover:border-charcoal disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-5 text-center font-sans text-sm tabular-nums">{qtd}</span>
                        <button
                          type="button"
                          onClick={() => definirQtd(extra.id, qtd + 1, maxQtd)}
                          disabled={qtd >= maxQtd}
                          aria-label={`Adicionar ${extra.nome}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-charcoal/20 text-charcoal/70 transition-colors hover:border-charcoal disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {algumNaoReembolsavel && (
            <p className="pt-3 font-sans text-xs text-charcoal/60">
              Itens marcados foram contratados dentro do prazo de{" "}
              {JANELA_CANCELAMENTO_EXTRAS_DIAS} dias e não têm reembolso.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
