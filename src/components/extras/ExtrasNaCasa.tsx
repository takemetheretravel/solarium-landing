"use client";

import { useEffect, useState } from "react";
import PersonalizeSuaEstadia from "./PersonalizeSuaEstadia";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import type { ContextoExtra } from "@/lib/tracking";

/**
 * Bloco de extras que busca a disponibilidade real antes de exibir.
 *
 * Usado na página da casa (recolhido) e no checkout (aberto). A seleção sobe pro
 * pai, que a carrega adiante — na casa, pela URL; no checkout, pro draft.
 */
export default function ExtrasNaCasa({
  propertySlug,
  checkin,
  checkout,
  contexto,
  selecao,
  onChange,
  recolhivel = true,
  ocultarIds = [],
  onDisponiveis,
}: {
  propertySlug: string;
  checkin: string;
  checkout: string;
  contexto: ContextoExtra;
  selecao: Record<string, number>;
  onChange: (s: Record<string, number>) => void;
  recolhivel?: boolean;
  /** Ids a esconder — ex.: cestas quando o pacote já traz café. */
  ocultarIds?: string[];
  /** Devolve ao pai o que o servidor ofereceu, com preço. Evita recalcular preço no cliente. */
  onDisponiveis?: (d: ExtraExibivel[]) => void;
}) {
  const [disponiveis, setDisponiveis] = useState<ExtraExibivel[]>([]);

  useEffect(() => {
    if (!checkin || !checkout) {
      setDisponiveis([]);
      return;
    }
    let cancelado = false;
    const params = new URLSearchParams({ property: propertySlug, checkin, checkout });

    fetch(`/api/extras/disponiveis?${params}`)
      .then((r) => (r.ok ? r.json() : { disponiveis: [] }))
      .then((d) => {
        if (cancelado) return;
        const lista = ((d.disponiveis ?? []) as ExtraExibivel[]).filter(
          (x) => !ocultarIds.includes(x.extra.id),
        );
        setDisponiveis(lista);
        onDisponiveis?.(lista);
      })
      .catch(() => {
        if (!cancelado) setDisponiveis([]);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertySlug, checkin, checkout, ocultarIds.join(",")]);

  if (disponiveis.length === 0) return null;

  return (
    <PersonalizeSuaEstadia
      contexto={contexto}
      disponiveis={disponiveis}
      selecao={selecao}
      onChange={onChange}
      recolhivel={recolhivel}
    />
  );
}

/** Serializa a seleção para o parâmetro `extras` da URL: `id:qty,id:qty`. */
export function serializarSelecao(selecao: Record<string, number>): string {
  return Object.entries(selecao)
    .filter(([, qtd]) => qtd > 0)
    .map(([id, qtd]) => (qtd === 1 ? id : `${id}:${qtd}`))
    .join(",");
}
