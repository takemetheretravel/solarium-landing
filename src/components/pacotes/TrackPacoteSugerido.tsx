"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  trackPacoteSugeridoNaBusca,
  trackPacoteSugeridoDataProxima,
} from "@/lib/tracking";

/**
 * Dispara `pacote_sugerido_na_busca` uma vez por exibição do bloco.
 *
 * Sem isto não há como saber se sugerir pacote na busca converte — e o bloco
 * ocupa espaço na página onde a pessoa escolhe a casa.
 */
export default function TrackPacoteSugerido({
  ids,
  deslocamentos,
}: {
  ids: string[];
  /** Noites de distância das datas pedidas, na mesma ordem de `ids`. 0 = exatas. */
  deslocamentos?: number[];
}) {
  useEffect(() => {
    ids.forEach((id, i) => registrar(id, deslocamentos?.[i] ?? 0, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), (deslocamentos ?? []).join(",")]);
  return null;
}

/** Data exata e data vizinha são perguntas diferentes, e eventos diferentes. */
function registrar(pacoteId: string, deslocamento: number, clicou: boolean): void {
  if (deslocamento > 0) {
    trackPacoteSugeridoDataProxima({ pacoteId, deslocamentoNoites: deslocamento, clicou });
  } else {
    trackPacoteSugeridoNaBusca({ pacoteId, clicou });
  }
}

/**
 * Card do pacote sugerido. Mesmo evento da exibição, com `clicou: true` — é o
 * par que permite comparar quantos viram e quantos entraram.
 */
export function LinkPacoteSugerido({
  pacoteId,
  href,
  className,
  deslocamento = 0,
  children,
}: {
  pacoteId: string;
  href: string;
  className?: string;
  deslocamento?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => registrar(pacoteId, deslocamento, true)}
    >
      {children}
    </Link>
  );
}
