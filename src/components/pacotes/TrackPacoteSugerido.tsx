"use client";

import { useEffect } from "react";
import Link from "next/link";
import { trackPacoteSugeridoNaBusca } from "@/lib/tracking";

/**
 * Dispara `pacote_sugerido_na_busca` uma vez por exibição do bloco.
 *
 * Sem isto não há como saber se sugerir pacote na busca converte — e o bloco
 * ocupa espaço na página onde a pessoa escolhe a casa.
 */
export default function TrackPacoteSugerido({ ids }: { ids: string[] }) {
  useEffect(() => {
    for (const id of ids) trackPacoteSugeridoNaBusca({ pacoteId: id, clicou: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  return null;
}

/**
 * Card do pacote sugerido. Mesmo evento da exibição, com `clicou: true` — é o
 * par que permite comparar quantos viram e quantos entraram.
 */
export function LinkPacoteSugerido({
  pacoteId,
  href,
  className,
  children,
}: {
  pacoteId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => trackPacoteSugeridoNaBusca({ pacoteId, clicou: true })}
    >
      {children}
    </Link>
  );
}
