"use client";

import { useEffect, useState } from "react";
import PersonalizeSuaEstadia from "./PersonalizeSuaEstadia";
import type { ExtraExibivel } from "@/lib/pricing/extras";
import type { ContextoExtra } from "@/lib/analytics/tracking";
import { useFetchDeduplicado, chaveDe } from "@/lib/client-fetch";

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

  // A chave é a combinação de parâmetros que a rota realmente usa. Os ids
  // ocultos ficam de fora: eles filtram a resposta, não mudam a consulta —
  // incluí-los faria o mesmo dado ser buscado de novo à toa.
  const ocultos = ocultarIds.join(",");
  const chave =
    checkin && checkout ? chaveDe("extras-disponiveis", propertySlug, checkin, checkout) : "";

  useEffect(() => {
    if (!checkin || !checkout) setDisponiveis([]);
  }, [checkin, checkout]);

  useFetchDeduplicado<{ disponiveis?: ExtraExibivel[] }>({
    chave,
    debounceMs: 300,
    buscar: async () => {
      const params = new URLSearchParams({ property: propertySlug, checkin, checkout });
      const r = await fetch(`/api/extras/disponiveis?${params}`);
      return r.ok ? r.json() : { disponiveis: [] };
    },
    aoResponder: (d) => {
      const lista = ((d.disponiveis ?? []) as ExtraExibivel[]).filter(
        (x) => !ocultarIds.includes(x.extra.id),
      );
      setDisponiveis(lista);
      onDisponiveis?.(lista);
    },
    aoFalhar: () => setDisponiveis([]),
  });

  // Reaplica o filtro quando só os ids ocultos mudam — sem refazer a chamada.
  useEffect(() => {
    setDisponiveis((prev) => prev.filter((x) => !ocultarIds.includes(x.extra.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocultos]);

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
