"use client";

import { useEffect, useState } from "react";
import { mensagemChegadaBloqueada } from "@/lib/pricing/mensagem-chegada";

/**
 * Restrições de chegada no seletor de datas.
 *
 * ESPELHO, NÃO AUTORIDADE. Quem recusa é o servidor — no cálculo de preço e,
 * por último, na criação do draft. Isto existe para o hóspede descobrir antes
 * de preencher o formulário inteiro, não para substituir a validação.
 *
 * `<input type="date">` não desabilita dias avulsos, então a marcação visual é
 * feita de duas formas: a lista das próximas datas bloqueadas sob o campo, e a
 * mensagem imediata quando a data escolhida é uma delas.
 */

/** Janela buscada de uma vez. Cobre a antecedência típica de uma reserva. */
const DIAS_A_FRENTE = 180;

function isoHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Conjunto de datas em que a casa não recebe chegada.
 *
 * Falha de rede devolve conjunto vazio — o seletor deixa de avisar, e a recusa
 * acontece na validação do servidor, que não depende disto.
 */
export function useDiasSemChegada(propertySlug: string): Set<string> {
  const [dias, setDias] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!propertySlug) return;
    let cancelado = false;
    const params = new URLSearchParams({
      property: propertySlug,
      inicio: isoHoje(),
      fim: isoMais(DIAS_A_FRENTE),
    });
    fetch(`/api/restricoes/chegada?${params}`)
      .then((r) => (r.ok ? r.json() : { dias: [] }))
      .then((d) => {
        if (!cancelado) setDias(new Set((d.dias ?? []) as string[]));
      })
      .catch(() => {
        if (!cancelado) setDias(new Set());
      });
    return () => {
      cancelado = true;
    };
  }, [propertySlug]);

  return dias;
}

function formatarBR(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Mensagem quando a data escolhida é chegada bloqueada, com saída pelo WhatsApp.
 * Não renderiza nada quando a data está livre.
 */
export function AvisoChegadaBloqueada({
  checkin,
  diasBloqueados,
  propertyNome,
}: {
  checkin: string;
  diasBloqueados: Set<string>;
  propertyNome?: string;
}) {
  if (!checkin || !diasBloqueados.has(checkin)) return null;

  const texto = encodeURIComponent(
    `Olá! Queria chegar em ${formatarBR(checkin)}${propertyNome ? ` no ${propertyNome}` : ""}, mas o site diz que não há chegada nesse dia. Vocês conseguem me ajudar?`,
  );

  return (
    <div className="mt-3 border border-copper/30 bg-copper/5 p-3">
      <p className="font-sans text-xs leading-relaxed text-charcoal">
        {mensagemChegadaBloqueada(checkin)}
      </p>
      <a
        href={`https://wa.me/5535984075652?text=${texto}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block font-sans text-xs text-copper underline underline-offset-2"
      >
        Falar com a gente no WhatsApp
      </a>
    </div>
  );
}

/**
 * Lista discreta das próximas datas sem chegada, sob o campo de check-in.
 * É o mais perto de "dia não selecionável" que o input nativo permite.
 */
export function ProximosDiasBloqueados({
  diasBloqueados,
  quantidade = 4,
}: {
  diasBloqueados: Set<string>;
  quantidade?: number;
}) {
  if (diasBloqueados.size === 0) return null;

  const hoje = isoHoje();
  const proximos = Array.from(diasBloqueados)
    .filter((d) => d >= hoje)
    .sort()
    .slice(0, quantidade);
  if (proximos.length === 0) return null;

  return (
    <p className="mt-1 font-sans text-[0.7rem] leading-relaxed text-charcoal/50">
      Sem chegada em: {proximos.map(formatarBR).join(" · ")}
    </p>
  );
}
