"use client";

import { useEffect, useRef } from "react";

/**
 * Requisições em voo, por chave de parâmetros, compartilhadas entre chamadores.
 *
 * O double-invoke do StrictMode monta o efeito, faz o cleanup e monta de novo.
 * Abortar no cleanup não resolve nada: a primeira requisição já saiu pela rede
 * e a segunda montagem dispara outra — é exatamente o par idêntico no mesmo
 * milissegundo que aparece nos logs. A correção é a segunda montagem ENCONTRAR
 * a promessa da primeira e se pendurar nela, em vez de criar outra.
 *
 * O mapa é de módulo (uma entrada por chave, apagada quando a promessa resolve),
 * então dois componentes distintos pedindo a mesma coisa também compartilham.
 */
const emVoo = new Map<string, Promise<unknown>>();

/**
 * Executa `buscar` no máximo uma vez por chave enquanto a requisição estiver em
 * voo. Chamadas concorrentes com a mesma chave recebem a mesma promessa.
 */
export function buscarUmaVez<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const existente = emVoo.get(chave);
  if (existente) return existente as Promise<T>;

  const promessa = buscar().finally(() => {
    emVoo.delete(chave);
  });
  emVoo.set(chave, promessa as Promise<unknown>);
  return promessa;
}

/** Só para teste: esvazia o mapa de requisições em voo. */
export function _limparEmVoo(): void {
  emVoo.clear();
}

/**
 * Busca de dados em efeito, sem chamada duplicada.
 *
 * Três problemas distintos apareciam nos logs, cada um com seu mecanismo:
 *
 *  1. Pares idênticos no mesmo milissegundo (StrictMode) → promessa
 *     compartilhada por chave, via `buscarUmaVez`.
 *  2. Rajadas enquanto o cliente mexe em data/hóspedes → `debounceMs`.
 *  3. Repetição da MESMA combinação de parâmetros já respondida → memória da
 *     última chave aplicada.
 *
 * O resultado nunca é aplicado depois que a chave mudou ou o componente
 * desmontou, então uma resposta atrasada não sobrescreve estado atual.
 */
export function useFetchDeduplicado<T>(params: {
  /** Chave que identifica a combinação de parâmetros. Vazia = não buscar. */
  chave: string;
  /** Executa a busca. */
  buscar: () => Promise<T>;
  /** Recebe o resultado, só se a chave ainda for a atual. */
  aoResponder: (dado: T) => void;
  /** Recebe a falha, só se a chave ainda for a atual. */
  aoFalhar?: (erro: unknown) => void;
  /** Milissegundos de espera antes de disparar. 0 = imediato. */
  debounceMs?: number;
}): void {
  const { chave, debounceMs = 0 } = params;

  // Refs para os callbacks: mudam de identidade a cada render e não podem
  // entrar nas dependências, ou o efeito re-dispara sozinho.
  const buscarRef = useRef(params.buscar);
  const responderRef = useRef(params.aoResponder);
  const falharRef = useRef(params.aoFalhar);
  buscarRef.current = params.buscar;
  responderRef.current = params.aoResponder;
  falharRef.current = params.aoFalhar;

  /** Última chave que já produziu resposta aplicada. */
  const respondidaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chave) return;
    if (respondidaRef.current === chave) return;

    let cancelado = false;

    const disparar = () => {
      if (cancelado) return;
      buscarUmaVez(chave, buscarRef.current)
        .then((dado) => {
          if (cancelado) return;
          respondidaRef.current = chave;
          responderRef.current(dado);
        })
        .catch((err) => {
          if (cancelado) return;
          falharRef.current?.(err);
        });
    };

    const timer = debounceMs > 0 ? setTimeout(disparar, debounceMs) : null;
    if (!timer) disparar();

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [chave, debounceMs]);
}

/** Monta uma chave estável a partir de partes; `undefined`/`null` viram vazio. */
export function chaveDe(...partes: (string | number | boolean | null | undefined)[]): string {
  return partes.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
}
